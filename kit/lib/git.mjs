// git 읽기 — HEAD · 작업 트리 상태 · 추적 파일 · 바뀐 파일 · 태그를 읽는다. 저장소를 바꾸는 명령은 없다.
// 부르는 곳: gate.mjs(증거 파일의 커밋과 바뀐 파일), 검사(ctx.git 으로 받는다).
// 먼저 읽을 파일: evidence.mjs(커밋과 dirty 값을 쓰는 곳).
import { execFileSync } from 'node:child_process'

const BASE_CANDIDATES = ['origin/main', 'origin/master', 'main', 'master']
const lines = (output) => (output ? output.split('\n').filter(Boolean) : [])
// git 은 ASCII 가 아닌 파일 이름을 따옴표와 8진수로 바꿔 낸다. 그러면 그 이름으로 파일을 읽지 못해 검사가 그 파일을 건너뛴다.
// 그래서 모든 호출에서 이름을 그대로 내게 한다.
const PLAIN_PATHS = ['-c', 'core.quotepath=false']
// 따옴표 · 역슬래시 · 탭 · 줄바꿈이 든 이름은 위 설정으로도 따옴표에 싸여 나온다. 경로 목록은 NUL 로 구분해 받아야 이름이 그대로 온다.
const NUL = '\0'
const splitPaths = (output) => (output ? output.split(NUL).filter(Boolean) : [])

// 작업 트리 상태는 저장소 · 사용자 설정 · GIT_CONFIG_* 환경 변수와 상관없이 같은 기준으로 읽는다. 명령에 붙인 -c 가 그 모두보다 먼저다.
// 추적하지 않는 파일과 서브모듈의 변경을 모두 센다. 파일 감시 도구(fsmonitor)와 추적하지 않는 파일의 캐시는 끈다. 그 답이 틀리면 바뀐 파일이 빠진다.
// 파일이 바뀌었는지는 기본 방식(checkStat=default)으로 견준다.
const STATUS_SETTINGS = ['status.showUntrackedFiles=all', 'core.fsmonitor=false', 'core.untrackedCache=false', 'core.checkStat=default']
const STATUS_CONFIG = STATUS_SETTINGS.flatMap((setting) => ['-c', setting])
const STATUS_ARGS = [...STATUS_CONFIG, 'status', '--porcelain', '--ignore-submodules=none', '--', '.', ':(exclude).lanekit']
// `ls-files -v` 의 표시 글자. 소문자는 assume-unchanged, S 는 skip-worktree 다. 이 표시가 있는 파일은 고쳐도 status 에 나오지 않는다.
const isHiddenFromStatus = (entry) => /^[a-zS] /.test(entry)

// git 이 읽는 저장소 · 작업 트리 · 인덱스 · 객체 저장소의 위치를 바꾸는 환경 변수.
const LOCATION_VARIABLES = new Set(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR'])

/**
 * 순수 함수. git 에 넘길 환경 변수. 위치를 바꾸는 변수만 뺀다. 남아 있으면 git 이 다른 저장소나 다른 인덱스를 읽는다.
 * GIT_CONFIG_* 는 그대로 둔다. CI 가 safe.directory 를 이 변수로 넣기 때문이다. 판정에 쓰는 설정은 명령의 -c 로 따로 고정한다.
 */
export function withoutGitEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !LOCATION_VARIABLES.has(name.toUpperCase())))
}

/** 파일 이름을 견줄 때 쓰는 꼴(NFC). macOS 의 디스크 이름은 풀어 쓴 꼴(NFD)이고 git 의 목록은 NFC 라서, 견주는 양쪽을 이 꼴로 맞춘다. */
export const toComparablePath = (path) => path.normalize('NFC')

/** root 에 묶인 git 도우미를 만든다. git 저장소가 아니면 읽는 함수가 null 이나 빈 목록을 돌려준다. */
export function createGit(root) {
  const run = (args) =>
    execFileSync('git', [...PLAIN_PATHS, ...args], {
      cwd: root,
      env: withoutGitEnv(process.env),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 256 * 1024 * 1024,
    }).trimEnd()

  // git 이 0 이 아닌 코드로 끝나는 것은 「없다」는 답이다(저장소 아님 · 그런 ref 없음). 그래서 null 로 바꿔 돌려준다.
  // git 실행 파일이 없는 경우처럼 종료 코드가 없는 오류는 숨기지 않고 다시 던진다.
  const tryRun = (args) => {
    try {
      return run(args)
    } catch (error) {
      if (typeof error.status !== 'number') throw error
      return null
    }
  }

  const isRepo = () => tryRun(['rev-parse', '--is-inside-work-tree']) === 'true'
  const head = () => tryRun(['rev-parse', 'HEAD'])

  /** 경로 목록을 내는 git 명령을 NUL 구분(-z)으로 돌려 이름을 그대로 받는다. 명령이 실패하면 null 이다. */
  const listPaths = (args) => {
    const output = tryRun([...args, '-z'])
    return output === null ? null : splitPaths(output)
  }

  /**
   * 작업 트리가 커밋과 같은지 읽는다: clean · changes(커밋하지 않은 변경이나 추적하지 않는 파일) ·
   * hidden-flags(assume-unchanged · skip-worktree 표시가 있어 변경을 알 수 없는 파일) · no-repo(git 저장소가 아니다).
   * 증거 · 보고 폴더(.lanekit)는 게이트가 쓰는 곳이라 뺀다.
   */
  const dirtyState = () => {
    const status = tryRun(STATUS_ARGS)
    if (status === null) return 'no-repo'
    if (status.length > 0) return 'changes'
    const flagged = (listPaths(['ls-files', '-v']) ?? []).filter(isHiddenFromStatus)
    return flagged.some((entry) => !entry.slice(2).startsWith('.lanekit/')) ? 'hidden-flags' : 'clean'
  }
  const isDirty = () => dirtyState() !== 'clean'

  const trackedFiles = () => listPaths(['ls-files']) ?? []
  const untrackedFiles = () => listPaths(['ls-files', '--others', '--exclude-standard']) ?? []
  const tags = () => lines(tryRun(['tag', '--list']))

  const findBase = (requested) => {
    const candidates = requested ? [requested] : BASE_CANDIDATES
    return candidates.find((ref) => tryRun(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null) ?? null
  }

  /** 기준 브랜치에서 갈라진 뒤 바뀐 파일과 아직 추적하지 않는 새 파일. 기준을 찾지 못하면 null(전체로 본다). */
  const changedFiles = (requestedBase) => {
    const base = findBase(requestedBase)
    const forkPoint = base && tryRun(['merge-base', 'HEAD', base])
    if (!forkPoint) return null
    const changed = listPaths(['diff', '--name-only', forkPoint]) ?? []
    return [...new Set([...changed, ...untrackedFiles()])].sort()
  }

  return { run, tryRun, listPaths, isRepo, head, isDirty, dirtyState, trackedFiles, untrackedFiles, tags, changedFiles }
}
