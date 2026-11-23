// git 이력 읽기 — 모든 커밋에서 더해진 줄, 커밋 메시지, 태그와 브랜치의 이름 · 태그를 단 사람을 읽는다. 지금은 지워진 내용도 이력에는 남기 때문이다.
// 부르는 곳: 검사(secrets · exposure)의 full 프로필.
// 먼저 읽을 파일: git.mjs(ctx.git 의 run · tryRun).
import { splitLines } from './platform.mjs'

const COMMIT_MARK = 'lanekit-commit '
// git 의 --format 에서는 %x01 · %x00 으로 적는다. 커밋 메시지에 나올 수 없는 글자라 구분자로 쓴다.
const RECORD_END = '\u0001'
const FIELD_END = '\u0000'

const BLOCK_START = 'diff --git '
const HUNK_START = '@@'
const NEW_FILE_HEADER = '+++ '
const NEW_SIDE_PREFIX = 'b/'
const NO_FILE = '/dev/null'
/** 머리줄에서 이름을 읽지 못한 파일에 붙이는 이름. 이름을 몰라도 더해진 줄은 버리지 않고 검사한다. */
export const UNKNOWN_FILE = '(unknown file)'

const SIMPLE_ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 }
const OCTAL_ESCAPE = /^[0-7]{3}/

/**
 * 순수 함수. git 이 따옴표로 감싼 경로(`"say\"hi.txt"`)를 원래 이름으로 푼다. 감싸지 않은 경로는 그대로 돌려준다.
 * 8진수(`\355\225\234`)는 UTF-8 바이트라서 바이트로 모은 뒤 한꺼번에 글자로 바꾼다.
 */
export function unquoteGitPath(quoted) {
  if (!quoted.startsWith('"') || !quoted.endsWith('"') || quoted.length < 2) return quoted
  const body = quoted.slice(1, -1)
  const bytes = []
  let index = 0
  while (index < body.length) {
    if (body[index] !== '\\') {
      bytes.push(...Buffer.from(body[index], 'utf8'))
      index += 1
      continue
    }
    const octal = body.slice(index + 1).match(OCTAL_ESCAPE)?.[0]
    bytes.push(octal ? Number.parseInt(octal, 8) : (SIMPLE_ESCAPES[body[index + 1]] ?? body.charCodeAt(index + 1)))
    index += octal ? 4 : 2
  }
  return Buffer.from(bytes).toString('utf8')
}

/** 순수 함수. `+++ ` 머리줄에서 파일 이름을 읽는다. 지워진 파일(/dev/null)이면 null 이다. */
function readNewFileName(headerLine) {
  // 이름에 공백이 있으면 git 이 머리줄 끝에 탭을 붙인다.
  const path = unquoteGitPath(headerLine.slice(NEW_FILE_HEADER.length).replace(/\t$/, ''))
  if (path === NO_FILE) return null
  return path.startsWith(NEW_SIDE_PREFIX) ? path.slice(NEW_SIDE_PREFIX.length) : path
}

/**
 * `git log -p` 출력에서 더해진 줄을 [{ commit, file, text }] 로 뽑는다. 순수 함수다.
 * 파일 머리줄(`+++ `)은 `diff --git` 줄과 첫 `@@` 줄 사이에서만 받는다. `@@` 뒤의 `+` 줄은 모두 내용이다.
 * 더한 내용이 `++ ` 로 시작하면 patch 에서 `+++ ` 로 보이기 때문이다.
 */
export function parseAddedLines(logOutput) {
  const added = []
  let commit = null
  let file = null
  let isInHeader = false
  for (const line of splitLines(logOutput)) {
    if (line.startsWith(COMMIT_MARK)) commit = line.slice(COMMIT_MARK.length)
    else if (line.startsWith(BLOCK_START)) [file, isInHeader] = [null, true]
    else if (isInHeader && line.startsWith(HUNK_START)) isInHeader = false
    else if (isInHeader && line.startsWith(NEW_FILE_HEADER)) file = readNewFileName(line)
    else if (!isInHeader && line.startsWith('+')) added.push({ commit, file: file ?? UNKNOWN_FILE, text: line.slice(1) })
  }
  return added
}

// 사용자의 git 설정(diff.noprefix · diff.mnemonicPrefix · textconv)에 따라 patch 의 모양이 달라지지 않게 고정한다.
const PATCH_SHAPE = ['--no-color', '--unified=0', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', `--dst-prefix=${NEW_SIDE_PREFIX}`]

/** 모든 브랜치의 커밋에서 더해진 줄. git 저장소가 아니거나 커밋이 없으면 빈 목록이다. */
export function readAddedLines(git) {
  const output = git.tryRun(['log', '--all', '-p', ...PATCH_SHAPE, `--format=${COMMIT_MARK}%H`])
  return output ? parseAddedLines(output) : []
}

/** 모든 브랜치의 커밋 메시지 [{ commit, text }]. text 의 첫 두 줄은 작성자와 커미터의 「이름 <이메일>」 이다. 이 칸도 공개된다. */
export function readCommitMessages(git) {
  const output = git.tryRun(['log', '--all', '--format=%H%x00%an <%ae>%n%cn <%ce>%n%B%x01'])
  if (!output) return []
  return output
    .split(RECORD_END)
    .map((record) => record.trim().split(FIELD_END))
    .filter((fields) => fields.length === 2)
    .map(([commit, text]) => ({ commit, text }))
}

const ANNOTATED_TAG = 'tag'
const REF_FORMAT = '--format=%(refname)%00%(objecttype)%00%(taggername) %(taggeremail)%00%(contents)%01'

/**
 * 태그와 브랜치 [{ ref, text }]. text 의 첫 줄은 ref 이름이다. 주석 달린 태그는 태그를 단 사람과 태그 메시지가 이어진다.
 * 이 칸들은 커밋에 들어 있지 않지만 `git push --tags` 와 브랜치 푸시로 공개된다. 주석 없는 태그의 내용은 커밋 메시지라서 넣지 않는다.
 */
export function readRefTexts(git) {
  const output = git.tryRun(['for-each-ref', REF_FORMAT, 'refs/tags', 'refs/heads'])
  if (!output) return []
  return output
    .split(RECORD_END)
    .map((record) => record.trim().split(FIELD_END))
    .filter((fields) => fields.length === 4)
    .map(([ref, objectType, tagger, contents]) => ({ ref, text: objectType === ANNOTATED_TAG ? [ref, tagger, contents].join('\n') : ref }))
}
