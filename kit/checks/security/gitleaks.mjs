// gitleaks 부르기 — gitleaks 를 돌려 보고 파일을 읽고, 내장 규칙과 같은 모양의 목록으로 바꾼다.
// 부르는 곳: secrets.mjs.
// 먼저 읽을 파일: secrets.mjs(결과를 받아 허용 목록을 적용하는 곳).
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { runTool } from '../../lib/exec.mjs'
import { readTextFile } from '../../lib/files.mjs'
import { toComparablePath } from '../../lib/git.mjs'
import { toPosixPath } from '../../lib/platform.mjs'

const FOUND_EXIT_CODE = 1

// lanekit 의 잠금 파일은 복사한 파일마다 sha256 을 적는다. gitleaks 의 일반 규칙이 이 해시를 비밀값으로 본다.
// 그래서 잠금 파일에서 찾은 것 가운데, 그 줄이 「"경로": "해시 64자"」 꼴인 것만 뺀다.
const LOCK_FILE = 'scripts/lanekit/lanekit.lock.json'
const HASH_VALUE = /^[0-9a-f]{64}$/

/**
 * 순수 함수. gitleaks 보고(JSON 배열)를 [{ file, line, rule, commit, sourceLine }] 로 바꾼다. 경로는 루트 기준으로 맞춘다.
 * gitleaks 는 디스크의 이름을 그대로 낸다. git 의 목록 · 허용 목록과 견줄 수 있게 이름을 NFC 로 맞춘다.
 */
export function parseGitleaksReport(reportText, root) {
  const toRelative = (file) => toComparablePath(toPosixPath(isAbsolute(file) ? relative(root, file) : file))
  return JSON.parse(reportText || '[]').map((leak) => ({
    file: toRelative(leak.File ?? ''),
    line: leak.Commit ? null : (leak.StartLine ?? null),
    rule: leak.RuleID ?? 'gitleaks',
    commit: leak.Commit || null,
    sourceLine: leak.StartLine ?? null,
  }))
}

// JSON 의 한 줄(`"키": 값,`)을 [키, 값] 으로 읽는다. 그런 꼴이 아니면 null 이다.
function readJsonLine(line) {
  try {
    return Object.entries(JSON.parse(`{${line.trim().replace(/,$/, '')}}`))[0] ?? null
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return null
  }
}

function readLockedHashes(text) {
  try {
    return JSON.parse(text)?.files ?? {}
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return {}
  }
}

/**
 * 순수 판정. 잠금 파일의 글(text)에서 찾은 것이 해시 줄인가. 글을 읽지 못했거나 줄 번호가 없으면 아니다.
 * 그 줄의 키와 값이 잠금 파일의 files 칸에 든 「경로: sha256」 과 같아야 한다. 다른 칸의 값은 해시처럼 보여도 빼지 않는다.
 */
export function isLockHash(leak, text) {
  if (leak.file !== LOCK_FILE || text === null || !leak.sourceLine) return false
  const pair = readJsonLine(text.split('\n')[leak.sourceLine - 1] ?? '')
  if (!pair || typeof pair[1] !== 'string' || !HASH_VALUE.test(pair[1])) return false
  const lockedHashes = readLockedHashes(text)
  return Object.hasOwn(lockedHashes, pair[0]) && lockedHashes[pair[0]] === pair[1]
}

/** 잠금 파일의 해시 줄을 뺀다. 이력에서 찾은 것은 그 커밋의 잠금 파일을 읽어 같은 줄을 본다. */
function dropLockHashes(found, ctx) {
  const textOf = (leak) => (leak.commit ? ctx.git.tryRun(['show', `${leak.commit}:${LOCK_FILE}`]) : readTextFile(ctx.root, LOCK_FILE))
  return found.filter((leak) => leak.file !== LOCK_FILE || !isLockHash(leak, textOf(leak)))
}

function detect(gitleaksFile, root, extraArgs) {
  const reportDir = mkdtempSync(join(tmpdir(), 'lanekit-gitleaks-'))
  const reportFile = join(reportDir, 'report.json')
  try {
    const args = ['detect', '--source', root, '--redact', '--no-banner', '--report-format', 'json', '--report-path', reportFile, ...extraArgs]
    const outcome = runTool(gitleaksFile, args, { cwd: root })
    if (outcome.code !== 0 && outcome.code !== FOUND_EXIT_CODE) {
      return { problem: `exit ${outcome.code ?? outcome.startError} ${outcome.stderr.trim().split('\n').at(-1) ?? ''}`.trim() }
    }
    // gitleaks 는 스스로 오류가 났을 때도 「찾았다」와 같은 코드로 끝난다. 보고 파일이 없으면 결과를 믿지 않는다.
    if (!existsSync(reportFile)) return { problem: `exit ${outcome.code} no report` }
    return { found: parseGitleaksReport(readFileSync(reportFile, 'utf8'), root) }
  } finally {
    rmSync(reportDir, { recursive: true, force: true })
  }
}

/**
 * 작업 트리를 보고, full 프로필이면 이력도 본다. 돌려주는 값은 { found } 나 { problem } 이다.
 * gitleaks 는 무시 규칙에 걸린 파일도 읽는다. 그래서 작업 트리에서 찾은 것은 추적 중인 파일로 좁힌다.
 */
export function runGitleaks(gitleaksFile, ctx) {
  const workTree = detect(gitleaksFile, ctx.root, ['--no-git'])
  if (workTree.problem) return workTree
  const tracked = ctx.git.isRepo() ? new Set(ctx.git.trackedFiles().map(toComparablePath)) : null
  const found = tracked ? workTree.found.filter((leak) => tracked.has(leak.file)) : workTree.found
  if (ctx.profile !== 'full' || !ctx.git.isRepo()) return { found: dropLockHashes(found, ctx) }
  const history = detect(gitleaksFile, ctx.root, [])
  return history.problem ? history : { found: dropLockHashes([...found, ...history.found], ctx) }
}
