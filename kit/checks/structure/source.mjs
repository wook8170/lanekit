// 측정 대상 고르기 — 프로젝트의 파일 목록을 얻고, 설정의 글롭과 확장자로 잴 소스 파일만 남긴다.
// 부르는 곳: run.mjs(측정 전).
// 먼저 읽을 파일: ../../lib/schema.mjs 의 structure.source(글롭의 기본값), ../../lib/glob.mjs(글롭 맞추기).
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createMatcher } from '../../lib/glob.mjs'

/** 파일 목록에서 잴 소스만 고른다. source 는 설정의 { include, exclude, extensions } 다. */
export function selectSources(files, source) {
  const isIncluded = createMatcher(source.include)
  const isExcluded = createMatcher(source.exclude)
  const extensions = new Set(source.extensions)
  const hasExtension = (file) => extensions.has(file.slice(file.lastIndexOf('.') + 1))
  return [...new Set(files)].filter((file) => hasExtension(file) && isIncluded(file) && !isExcluded(file)).sort()
}

function walkFiles(root, dir = '') {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') return []
    const relativePath = dir ? `${dir}/${entry.name}` : entry.name
    return entry.isDirectory() ? walkFiles(root, relativePath) : [relativePath]
  })
}

/**
 * 프로젝트의 파일 목록(루트 기준 경로). git 저장소면 추적 파일과 무시되지 않은 새 파일이다.
 * 목록은 NUL 구분으로 받는다. 따옴표 · 탭이 든 이름도 그대로 와야 그 파일을 잰다.
 * git 저장소가 아니면 폴더를 직접 훑는다. 이때 숨김 폴더와 node_modules 는 뺀다.
 */
export function listProjectFiles(root, git) {
  return git?.listPaths(['ls-files', '--cached', '--others', '--exclude-standard']) ?? walkFiles(root)
}
