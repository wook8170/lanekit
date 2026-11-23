// 프로젝트 파일 읽기 — 검사가 볼 파일 목록을 만들고, 글자 파일만 읽는다. 바이너리와 아주 큰 파일은 건너뛴다.
// 부르는 곳: 검사(docs-drift · writing · secrets · exposure).
// 먼저 읽을 파일: git.mjs(추적 파일 목록이 오는 곳).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SKIPPED_DIRS = new Set(['.git', 'node_modules', '.lanekit'])
const MAX_TEXT_BYTES = 2 * 1024 * 1024

function walk(root, relativeDir, found) {
  for (const entry of readdirSync(join(root, relativeDir), { withFileTypes: true })) {
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) walk(root, relativePath, found)
    } else if (entry.isFile()) {
      found.push(relativePath)
    }
  }
  return found
}

/** git 저장소면 추적 중인 파일, 아니면 폴더를 걸어 찾은 파일. 경로는 루트 기준이고 `/` 로 나눈다. */
export function listTrackedFiles(root, git) {
  return git?.isRepo() ? git.trackedFiles() : walk(root, '', []).sort()
}

/** 추적 중인 파일에 아직 추적하지 않는 새 파일을 더한다. 무시 규칙(.gitignore)에 걸린 파일은 뺀다. */
export function listWorkFiles(root, git) {
  if (!git?.isRepo()) return walk(root, '', []).sort()
  return [...new Set([...git.trackedFiles(), ...git.untrackedFiles()])].sort()
}

/** 글자 파일의 내용. 없는 파일 · 폴더 · 바이너리(NUL 바이트가 있다) · 상한보다 큰 파일은 null 이다. */
export function readTextFile(root, relativePath) {
  const file = join(root, relativePath)
  const stats = statSync(file, { throwIfNoEntry: false })
  if (!stats?.isFile() || stats.size > MAX_TEXT_BYTES) return null
  const content = readFileSync(file)
  return content.includes(0) ? null : content.toString('utf8')
}
