// 잠금 파일 — 프로젝트로 복사한 파일의 sha256 을 적고, 지금 파일과 견주어 「그대로 · 고침 · 없음」을 가른다.
// 부르는 곳: init(복사 뒤 잠금 파일 쓰기), doctor(복사본 점검), update(원본 그대로인 파일만 바꾸기).
// 먼저 읽을 파일: cli.mjs(하위 명령이 불리는 곳).
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { toLfBytes } from '../kit/lib/platform.mjs'

export const LOCK_FILE = 'lanekit.lock.json'
export const LOCK_SCHEMA = 'lanekit-lock/1'

// 복사본 폴더에 있어도 잠금 대상이 아닌 것: 잠금 파일 자신과 프로젝트가 만드는 기준선.
const isProjectOwned = (relativePath) => relativePath === LOCK_FILE || relativePath.startsWith('baselines/')

/** 내용의 sha256. 줄바꿈을 LF 로 맞춘 뒤 잰다. Windows 의 체크아웃이 줄바꿈을 CRLF 로 바꿔도 「고침」으로 보지 않기 위해서다. */
export const hashContent = (content) => createHash('sha256').update(toLfBytes(content)).digest('hex')

export const hashFile = (file) => hashContent(readFileSync(file))

/** dir 아래 파일을 '/' 로 이은 상대 경로로, 이름순으로 돌려준다. */
export function listFiles(dir, prefix = '') {
  const entries = readdirSync(join(dir, prefix), { withFileTypes: true })
  const paths = entries.flatMap((entry) => {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    return entry.isDirectory() ? listFiles(dir, relativePath) : [relativePath]
  })
  return paths.sort()
}

/** dir 의 지금 해시 { 상대 경로: sha256 }. 잠금 대상이 아닌 파일은 뺀다. */
export function hashTree(dir) {
  const lockable = listFiles(dir).filter((relativePath) => !isProjectOwned(relativePath))
  return Object.fromEntries(lockable.map((relativePath) => [relativePath, hashFile(join(dir, relativePath))]))
}

/** 복사 직후에 부른다. dir 의 지금 상태를 잠금 파일의 모양으로 만든다. */
export function buildLock(dir, version) {
  return { schema: LOCK_SCHEMA, version, files: hashTree(dir) }
}

/** 순수 판정. 잠금 파일의 해시와 지금 해시를 견준다. extra 는 잠금 파일에 없는데 폴더에 있는 파일이다. */
export function diffLock(lockedFiles, actualFiles) {
  const lockedPaths = Object.keys(lockedFiles)
  return {
    same: lockedPaths.filter((path) => actualFiles[path] === lockedFiles[path]),
    modified: lockedPaths.filter((path) => actualFiles[path] !== undefined && actualFiles[path] !== lockedFiles[path]),
    missing: lockedPaths.filter((path) => actualFiles[path] === undefined),
    extra: Object.keys(actualFiles).filter((path) => lockedFiles[path] === undefined),
  }
}

/** 잠금 파일을 읽는다. 없거나 모양이 다르면 null 이다. */
export function readLock(dir) {
  const file = join(dir, LOCK_FILE)
  if (!existsSync(file)) return null
  const lock = JSON.parse(readFileSync(file, 'utf8'))
  return lock.schema === LOCK_SCHEMA && typeof lock.files === 'object' ? lock : null
}

/** 순수 함수. 잠금 파일에 쓰는 글. */
export const serializeLock = (lock) => `${JSON.stringify(lock, null, 2)}\n`

export function writeLock(dir, lock) {
  writeFileSync(join(dir, LOCK_FILE), serializeLock(lock))
}

/** 복사본 폴더를 잠금 파일과 견준다. 잠금 파일이 없으면 null 이다. */
export function compareWithLock(dir) {
  const lock = readLock(dir)
  return lock ? { version: lock.version, ...diffLock(lock.files, hashTree(dir)) } : null
}
