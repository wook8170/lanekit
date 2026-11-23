// 플랫폼 차이 — Windows 와 macOS · Linux 가 다르게 다루는 것(경로 · 줄바꿈 · 셸 인용 · 실행 파일 이름 · 설정 폴더)을 한곳에서 정한다.
// 부르는 곳: exec.mjs · safe-write.mjs · gate.mjs, 검사(tests · exposure · secrets 등), 플러그인 쪽 lib/(process.mjs · lock.mjs · doctor-checks/).
// 먼저 읽을 파일: exec.mjs(실행 계획을 쓰는 곳), safe-write.mjs(경로 판정을 쓰는 곳). isEntryScript 만 디스크를 읽고 나머지는 순수 함수다.
import { realpathSync } from 'node:fs'
import { posix, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

export const WINDOWS = 'win32'

const pathApiOf = (platform) => (platform === WINDOWS ? win32 : posix)

// ── 줄바꿈 ───────────────────────────────────────────────

/** 글을 줄로 나눈다. CRLF 로 저장된 파일에서도 줄 끝에 `\r` 이 남지 않는다. 남으면 `$` 로 끝을 보는 규칙이 맞지 않는다. */
export const splitLines = (text) => text.split(/\r?\n/)

const CR = 13
const LF = 10

/** 바이트에서 CRLF 를 LF 로 바꾼다. 같은 파일이 체크아웃 설정(autocrlf)에 따라 줄바꿈만 달라져도 같은 해시가 나오게 하는 데 쓴다. */
export function toLfBytes(content) {
  if (!content.includes(CR)) return content
  return Buffer.from(content.filter((byte, index) => !(byte === CR && content[index + 1] === LF)))
}

// ── 경로 ─────────────────────────────────────────────────

/** 저장소 안의 경로를 `/` 로 나눈 꼴로 맞춘다. 증거 파일 · 출력 · 글롭은 어느 플랫폼에서든 이 꼴을 쓴다. */
export const toPosixPath = (path, platform = process.platform) => (platform === WINDOWS ? path.replaceAll('\\', '/') : path)

/** 두 절대 경로가 같은 곳인가. Windows 는 대소문자와 구분자(`/` · `\`)를 가리지 않는다. */
export function isSamePath(left, right, platform = process.platform) {
  const pathApi = pathApiOf(platform)
  const toComparable = (path) => (platform === WINDOWS ? pathApi.normalize(path).toLowerCase() : pathApi.normalize(path))
  return toComparable(left) === toComparable(right)
}

/** candidate 가 dir 자신이거나 그 아래인가. 둘 다 절대 경로다. Windows 는 대소문자를 가리지 않고, 드라이브가 다르면 밖이다. */
export function isInsideDir(dir, candidate, platform = process.platform) {
  const pathApi = pathApiOf(platform)
  const fromDir = pathApi.relative(dir, candidate)
  if (fromDir === '') return true
  return fromDir !== '..' && !fromDir.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(fromDir)
}

/**
 * 지금 도는 스크립트가 이 모듈 파일인가(`node gate.mjs` 로 직접 불렸는가).
 * Node 는 모듈 주소를 링크를 따라간 실제 경로로 만든다. 그래서 인자의 경로도 실제 경로로 바꿔 견준다.
 */
export function isEntryScript(scriptPath, moduleUrl, platform = process.platform) {
  if (!scriptPath) return false
  try {
    return isSamePath(realpathSync(resolve(scriptPath)), fileURLToPath(moduleUrl), platform)
  } catch (error) {
    // 인자가 파일이 아닌 실행(예: 테스트 실행기가 넘긴 이름)에서는 직접 불린 것이 아니다.
    if (error.code !== 'ENOENT') throw error
    return false
  }
}

/** 사용자 설정 폴더. Windows 는 `%APPDATA%\lanekit`, 그 밖에는 `~/.config/lanekit` 이다. */
export function userConfigDir({ env, home, platform = process.platform }) {
  if (platform !== WINDOWS) return posix.join(home, '.config', 'lanekit')
  return win32.join(env.APPDATA || win32.join(home, 'AppData', 'Roaming'), 'lanekit')
}

// ── 실행 파일 ────────────────────────────────────────────

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD'
const BATCH_FILE = /\.(cmd|bat)$/i

/** PATH 환경 변수에서 폴더를 나누는 글자. */
export const pathListSeparator = (platform = process.platform) => (platform === WINDOWS ? ';' : ':')

/**
 * 한 폴더에서 찾아볼 파일 이름들. Windows 에서는 PATHEXT 의 확장자를 붙인 이름을 먼저 본다.
 * 확장자 없는 이름을 먼저 보면 `npm` 처럼 셸 스크립트가 함께 놓인 명령에서 실행할 수 없는 파일이 잡힌다.
 */
export function executableNames(name, env, platform) {
  if (platform !== WINDOWS) return [name]
  const extensions = (env.PATHEXT || DEFAULT_PATHEXT).split(';').filter(Boolean)
  return [...extensions.map((extension) => `${name}${extension.toLowerCase()}`), name]
}

/** 파일의 권한 비트(실행 권한)를 쓰는 플랫폼인가. Windows 의 파일에는 실행 비트가 없다. */
export const hasModeBits = (platform = process.platform) => platform !== WINDOWS

const RENAME_RETRIES = 5
const BUSY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

/**
 * 이름 바꾸기가 실패했을 때 다시 해 볼 것인가. attempt 는 지금까지 실패한 횟수다.
 * Windows 에서는 백신이나 색인 도구가 방금 만든 파일을 잠깐 열어 두어 이름 바꾸기가 거절될 수 있다. 잠시 뒤에는 된다.
 */
export function shouldRetryRename(errorCode, attempt, platform = process.platform) {
  return platform === WINDOWS && attempt < RENAME_RETRIES && BUSY_CODES.has(errorCode)
}

// ── 셸 인용 ──────────────────────────────────────────────

const quoteForPosixShell = (text) => `'${text.replaceAll("'", "'\\''")}'`

/**
 * cmd.exe 에 넘길 인자 하나를 감싼다. 큰따옴표 안에서는 `&` · `|` · `<` · `>` · `^` · 공백이 글자 그대로 넘어간다.
 * `%` 는 큰따옴표 안에서도 변수로 풀린다. 그래서 따옴표를 잠깐 닫고 `^%` 로 적는다.
 * 끝의 역슬래시와 큰따옴표 앞의 역슬래시는 두 배로 적는다. 그대로 두면 프로그램이 닫는 따옴표를 글자로 읽는다.
 * 큰따옴표가 든 인자는 cmd.exe 가 따옴표의 짝을 다르게 세므로 안전하지 않다. Windows 의 파일 이름에는 큰따옴표가 올 수 없다.
 */
function quoteForCmd(text) {
  const escaped = text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')
  return `"${escaped}"`.replaceAll('%', '"^%"')
}

/** 셸 명령 줄에 끼워 넣을 인자 하나를 그 플랫폼의 셸이 한 낱말로 읽게 감싼다. */
export const quoteShellArg = (text, platform = process.platform) => (platform === WINDOWS ? quoteForCmd(text) : quoteForPosixShell(text))

/**
 * 실행 파일과 인자를 spawn 에 넘길 꼴 { command, args, shell } 로 바꾼다.
 * Windows 의 배치 파일(.cmd · .bat)은 셸을 거쳐야 실행되고, 이때 Node 는 인자를 감싸 주지 않는다. 그래서 명령 줄 하나로 감싸서 넘긴다.
 */
export function planSpawn(file, args, platform = process.platform) {
  if (platform !== WINDOWS || !BATCH_FILE.test(file)) return { command: file, args, shell: false }
  return { command: [file, ...args].map((word) => quoteForCmd(word)).join(' '), args: [], shell: true }
}
