// 저장소 안에만 쓰기 — 쓰거나 지울 경로가 심볼릭 링크를 거쳐 저장소 밖으로 나가는지 판정하고, 나가지 않을 때만 쓰고 지운다.
// 부르는 곳: 게이트의 쓰기(evidence.mjs · baseline.mjs · 검사의 기록 파일)와 설치 명령(../../lib 의 init-apply.mjs · init-followup.mjs · update.mjs).
// 먼저 읽을 파일: ../../lib/init-apply.mjs 의 markBlocked(계획 단계에서 막힌 경로를 사용자에게 알리는 곳).
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { isInsideDir, shouldRetryRename } from './platform.mjs'

const EXECUTABLE_MODE = 0o755

/** 막힌 경로에 쓰거나 지우려 했다. 부르는 쪽이 isBlockedPath 로 먼저 걸러 알리므로, 이 오류는 거르지 못한 경로가 있다는 뜻이다. */
export class BlockedPathError extends Error {
  constructor(path) {
    super(`blocked path: ${path}`)
    this.name = 'BlockedPathError'
    this.path = path
  }
}

// 없는 경로와, 폴더가 아닌 것 아래의 경로는 null 이다.
function lstatOrNull(file) {
  try {
    return lstatSync(file)
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
    return null
  }
}

/** 경로 위쪽에서 실제로 있는 가장 가까운 것(폴더이거나, 폴더 자리에 놓인 파일 · 링크). */
function nearestExisting(file) {
  let current = dirname(file)
  while (lstatOrNull(current) === null) current = dirname(current)
  return current
}

/**
 * 쓸 수 없는 경로인가. 다음 가운데 하나면 그렇다.
 * 경로 자신이 심볼릭 링크다(끊긴 링크면 링크가 가리키는 저장소 밖에 파일이 생긴다) · 위 폴더가 링크를 거쳐 저장소 밖으로 나간다
 * · 폴더가 있어야 할 자리에 파일이나 끊긴 링크가 있다.
 * 하드 링크는 막지 않는다. 쓸 때 새 파일로 바꿔 놓으므로 다른 이름의 내용은 바뀌지 않는다(replaceFile).
 */
export function isBlockedPath(root, path) {
  if (lstatOrNull(join(root, path))?.isSymbolicLink()) return true
  const parent = nearestExisting(join(root, path))
  if (!existsSync(parent)) return true
  const realParent = realpathSync(parent)
  if (!lstatSync(realParent).isDirectory()) return true
  return !isInsideDir(realpathSync(root), realParent)
}

const TEMP_SUFFIX_BYTES = 6
const PERMISSION_BITS = 0o777

const STALE_AFTER_MS = 60 * 60 * 1000
const escapeForPattern = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 같은 파일을 쓰다가 죽은 실행이 남긴 임시 파일(`<이름>.<16진수 12자>.tmp`)을 지운다.
 * 한 시간이 지난 것만 지운다. 지금 쓰고 있는 다른 실행의 임시 파일을 건드리지 않기 위해서다.
 */
function removeStaleStagingFiles(file, now = Date.now()) {
  const leftover = new RegExp(`^${escapeForPattern(basename(file))}\\.[0-9a-f]{${TEMP_SUFFIX_BYTES * 2}}\\.tmp$`)
  for (const name of readdirSync(dirname(file)).filter((candidate) => leftover.test(candidate))) {
    const stats = lstatOrNull(join(dirname(file), name))
    if (stats?.isFile() && now - stats.mtimeMs > STALE_AFTER_MS) rmSync(join(dirname(file), name), { force: true })
  }
}

const RETRY_DELAY_MS = 20
const pause = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)

// 이름을 바꿔 그 자리의 파일을 대신한다. 다시 해 볼 실패인지는 platform.mjs 가 정한다(Windows 에서 다른 프로그램이 파일을 잠깐 열어 둔 경우).
function renameOver(stagingFile, file) {
  for (let failures = 0; ; failures += 1) {
    try {
      renameSync(stagingFile, file)
      return
    } catch (error) {
      if (!shouldRetryRename(error.code, failures)) throw error
      pause(RETRY_DELAY_MS * (failures + 1))
    }
  }
}

/**
 * 파일을 새 내용으로 바꿔 놓는다. 같은 폴더의 임시 파일에 쓴 뒤 이름을 바꾼다.
 * 그 자리의 파일을 열어 덮어쓰지 않으므로, 하드 링크로 이어진 다른 이름(저장소 밖일 수 있다)의 내용은 그대로 남는다.
 * 임시 파일은 없는 이름으로만 만든다(wx). 누가 그 이름에 링크를 놓아두었으면 쓰지 않고 오류로 끝난다.
 * 쓰기나 이름 바꾸기가 실패하면 임시 파일을 지우고 오류를 다시 던진다.
 */
function replaceFile(file, content, mode) {
  removeStaleStagingFiles(file)
  const stagingFile = `${file}.${randomBytes(TEMP_SUFFIX_BYTES).toString('hex')}.tmp`
  try {
    writeFileSync(stagingFile, content, { flag: 'wx' })
    if (mode !== undefined) chmodSync(stagingFile, mode)
    renameOver(stagingFile, file)
  } catch (error) {
    rmSync(stagingFile, { force: true })
    throw error
  }
}

// 이미 있는 파일을 바꿀 때는 그 파일의 권한을 새 파일에 옮긴다. 실행 파일로 쓰라고 했으면 그 권한이 먼저다.
function modeFor(file, executable) {
  if (executable) return EXECUTABLE_MODE
  const stats = lstatOrNull(file)
  return stats ? stats.mode & PERMISSION_BITS : undefined
}

/** root 아래 path 에 쓴다. 위 폴더가 없으면 만든다. 막힌 경로면 쓰지 않고 BlockedPathError 를 던진다. */
export function writeInside(root, path, content, { executable = false } = {}) {
  if (isBlockedPath(root, path)) throw new BlockedPathError(path)
  const file = join(root, path)
  mkdirSync(dirname(file), { recursive: true })
  replaceFile(file, content, modeFor(file, executable))
}

/**
 * root 아래 path 의 파일 끝에 덧붙인다. 위 폴더가 없으면 만든다. 막힌 경로면 쓰지 않고 BlockedPathError 를 던진다.
 * 지금 내용을 읽어 덧붙인 새 파일로 바꿔 놓는다. 그 자리에서 덧붙이면 하드 링크로 이어진 다른 이름에도 써지기 때문이다.
 */
export function appendInside(root, path, content) {
  if (isBlockedPath(root, path)) throw new BlockedPathError(path)
  const file = join(root, path)
  mkdirSync(dirname(file), { recursive: true })
  const existing = lstatOrNull(file) ? readFileSync(file, 'utf8') : ''
  replaceFile(file, `${existing}${content}`, modeFor(file, false))
}

/** root 아래 path 의 파일을 지운다. 막힌 경로면 지우지 않고 BlockedPathError 를 던진다. */
export function removeInside(root, path) {
  if (isBlockedPath(root, path)) throw new BlockedPathError(path)
  rmSync(join(root, path))
}
