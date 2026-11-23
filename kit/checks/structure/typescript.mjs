// TypeScript 컴파일러 찾기 — 프로젝트에 설치된 typescript 를 찾아, 측정 코드가 함께 쓰도록 묶어 둔다.
// 부르는 곳: run.mjs(검사를 시작할 때 한 번). measure.mjs · readable.mjs 는 여기의 ts 를 가져다 쓴다.
// 먼저 읽을 파일: run.mjs(찾지 못했을 때 검사를 건너뛰는 곳).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

// lanekit 은 실행 의존성을 두지 않는다. 그래서 컴파일러를 import 문으로 가져오지 않고, 찾은 것을 이 변수에 묶는다.
// 내보낸 변수는 가져다 쓰는 파일에서도 바뀐 값이 그대로 보인다.
export let ts = null

export function bindTypescript(compiler) {
  ts = compiler
}

/** 구문 트리를 만드는 API 가 있는가. 이 API 가 없는 버전은 측정에 쓸 수 없다. */
export const hasCompilerApi = (compiler) =>
  typeof compiler?.createSourceFile === 'function' && typeof compiler?.forEachChild === 'function'

function requireFrom(dir) {
  try {
    return createRequire(join(dir, 'package.json'))('typescript')
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error
    return null
  }
}

/** package.json 의 workspaces 와 pnpm-workspace.yaml 에 적힌 폴더 패턴. */
function readWorkspacePatterns(root) {
  const patterns = []
  const manifestFile = join(root, 'package.json')
  if (existsSync(manifestFile)) {
    const declared = JSON.parse(readFileSync(manifestFile, 'utf8')).workspaces
    patterns.push(...(Array.isArray(declared) ? declared : (declared?.packages ?? [])))
  }
  const pnpmFile = join(root, 'pnpm-workspace.yaml')
  if (existsSync(pnpmFile)) {
    for (const line of readFileSync(pnpmFile, 'utf8').split('\n')) {
      const pattern = /^\s*-\s*['"]?([^'"#\s]+)/.exec(line)?.[1]
      if (pattern) patterns.push(pattern)
    }
  }
  return patterns
}

/** 패턴 하나를 실제 폴더로 푼다. `apps/*` 처럼 끝이 한 단계 별표인 것과 별표 없는 경로만 푼다. */
function expandPattern(root, pattern) {
  if (pattern.startsWith('!')) return []
  if (!pattern.includes('*')) return [join(root, pattern)]
  const parent = pattern.endsWith('/*') ? pattern.slice(0, -2) : null
  if (parent === null || parent.includes('*') || !existsSync(join(root, parent))) return []
  return readdirSync(join(root, parent), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, parent, entry.name))
    .sort()
}

/**
 * typescript 모듈을 찾는다. 없으면 null 이다.
 * from 을 주면 그 폴더에서만 찾는다. 주지 않으면 저장소 루트 → 워크스페이스 폴더 순서로 찾는다.
 */
export function locateTypescript(root, from = '') {
  const dirs = from ? [resolve(root, from)] : [root, ...readWorkspacePatterns(root).flatMap((pattern) => expandPattern(root, pattern))]
  for (const dir of dirs) {
    const compiler = requireFrom(dir)
    if (compiler) return compiler
  }
  return null
}
