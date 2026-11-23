// 순환 의존 찾기 — 상대 경로 값 import 로 만든 파일 그래프에서 서로 물린 파일 묶음(강연결 요소)을 찾는다.
// 부르는 곳: ratchet.mjs(측정 결과를 규칙별 값으로 바꿀 때).
// 먼저 읽을 파일: measure.mjs(파일마다 imports 를 모으는 곳).
//
// 타입만 가져오는 import(`import type` · 모든 이름이 `type`)와 동적 import(`await import()`)는 실행 순서에 영향이 없어서 뺀다.
// 별칭(`@/…`)과 패키지 import 는 보지 않는다. 대상은 상대 경로뿐이다.
import { posix } from 'node:path'

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.vue', '.js', '.mjs', '.jsx']

/** import 문자열 → 측정 대상 파일 경로. 대상이 아니면 null 이다. known 은 측정 대상 경로의 Set 이다. */
export function resolveImport(fromFile, specifier, known) {
  const base = posix.normalize(posix.join(posix.dirname(fromFile), specifier))
  const stem = base.replace(/\.(js|mjs|jsx)$/, '')
  const candidates = [
    base,
    ...EXTENSIONS.map((extension) => stem + extension),
    ...EXTENSIONS.map((extension) => `${base}/index${extension}`),
  ]
  return candidates.find((candidate) => known.has(candidate)) ?? null
}

/** 측정 결과 { 파일: { imports } } → 값 import 그래프 { 파일: [가져오는 파일 …] }. */
export function buildImportGraph(measured) {
  const known = new Set(Object.keys(measured))
  const graph = {}
  for (const [file, measurement] of Object.entries(measured)) {
    const targets = measurement.imports
      .filter((imported) => !imported.typeOnly)
      .map((imported) => resolveImport(file, imported.spec, known))
      .filter(Boolean)
    graph[file] = [...new Set(targets)]
  }
  return graph
}

/** 그래프 → 파일이 2개 이상인 강연결 요소의 목록. 묶음 안은 정렬하고, 목록은 첫 파일 순서다(타잔 알고리즘). */
export function findCycles(graph) {
  const order = new Map()
  const lowest = new Map()
  const stack = []
  const onStack = new Set()
  const groups = []
  const visit = (file) => {
    order.set(file, order.size)
    lowest.set(file, order.get(file))
    stack.push(file)
    onStack.add(file)
    for (const target of graph[file] ?? []) {
      if (!order.has(target)) {
        visit(target)
        lowest.set(file, Math.min(lowest.get(file), lowest.get(target)))
      } else if (onStack.has(target)) {
        lowest.set(file, Math.min(lowest.get(file), order.get(target)))
      }
    }
    if (lowest.get(file) !== order.get(file)) return
    const group = stack.splice(stack.lastIndexOf(file))
    group.forEach((member) => onStack.delete(member))
    if (group.length > 1) groups.push(group.sort())
  }
  for (const file of Object.keys(graph).sort()) if (!order.has(file)) visit(file)
  return groups.sort((left, right) => left[0].localeCompare(right[0]))
}

/**
 * 순환 묶음 → 기준선과 견줄 값 { 파일: 그 파일이 든 묶음의 크기 }.
 * 순환에 새 파일이 들어오면 새 칸이 생기고, 두 묶음이 합쳐지면 값이 커진다. 둘 다 래칫에서 「늘었다」로 잡힌다.
 */
export function cycleSizes(groups) {
  return Object.fromEntries(groups.flatMap((group) => group.map((file) => [file, group.length])))
}
