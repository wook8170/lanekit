// 순환 의존 테스트 — import 경로 풀기, 순환 묶음 찾기, 순환이 래칫에서 「늘었다」로 잡히는 모양을 본다.
// 대상: kit/checks/structure/cycles.mjs 와 ratchet.mjs 의 cycles 규칙.
// 먼저 읽을 파일: structure-helpers.mjs.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildImportGraph, cycleSizes, findCycles, resolveImport } from '../kit/checks/structure/cycles.mjs'
import { increasesAgainst, useTypescript, valuesOf } from './structure-helpers.mjs'

useTypescript()

const HEAD = '// 머리 주석\n'
const importing = (...specs) => HEAD + specs.map((spec, index) => `import { value${index} } from '${spec}'\nexport const use${index} = value${index}\n`).join('')

test('import 경로 — .js 를 .ts 로 풀고, 폴더는 index 파일로 푼다', () => {
  const known = new Set(['s/a.ts', 's/b/index.ts', 's/c.vue', 's/d.mjs'])
  assert.equal(resolveImport('s/x.ts', './a.js', known), 's/a.ts')
  assert.equal(resolveImport('s/x.ts', './b', known), 's/b/index.ts')
  assert.equal(resolveImport('s/x.ts', './c.vue', known), 's/c.vue')
  assert.equal(resolveImport('s/deep/x.ts', '../d.mjs', known), 's/d.mjs')
  assert.equal(resolveImport('s/x.ts', './none.js', known), null)
})

test('순환 묶음 — 파일이 2개 이상인 강연결 요소만 낸다', () => {
  assert.deepEqual(findCycles({ a: ['b'], b: ['a', 'c'], c: [], d: ['d'] }), [['a', 'b']])
  assert.deepEqual(findCycles({ a: ['b'], b: ['c'], c: ['a'], x: ['y'], y: ['x'], z: ['a'] }), [['a', 'b', 'c'], ['x', 'y']])
  assert.deepEqual(findCycles({ a: ['b'], b: ['c'], c: [] }), [])
  assert.deepEqual(cycleSizes([['a', 'b', 'c'], ['x', 'y']]), { a: 3, b: 3, c: 3, x: 2, y: 2 })
})

test('그래프 — 타입만 가져오는 import 와 대상 밖의 경로는 선으로 치지 않는다', () => {
  const measured = {
    's/a.ts': { imports: [{ spec: './b.js', typeOnly: false }, { spec: './c.js', typeOnly: true }, { spec: './gone.js', typeOnly: false }] },
    's/b.ts': { imports: [{ spec: './a.js', typeOnly: false }, { spec: './a.js', typeOnly: false }] },
    's/c.ts': { imports: [{ spec: './a.js', typeOnly: false }] },
  }
  assert.deepEqual(buildImportGraph(measured), { 's/a.ts': ['s/b.ts'], 's/b.ts': ['s/a.ts'], 's/c.ts': ['s/a.ts'] })
})

test('소스에서 — 값 import 가 서로 물리면 두 파일에 묶음 크기가 실리고, import type 은 순환이 아니다', () => {
  const cyclic = valuesOf({ 's/a.ts': importing('./b.js'), 's/b.ts': importing('./a.js') })
  assert.deepEqual(cyclic.cycles, { 's/a.ts': 2, 's/b.ts': 2 })
  const typeOnly = valuesOf({ 's/a.ts': importing('./b.js'), 's/b.ts': `${HEAD}import type { Use } from './a.js'\nexport const value0 = 1\n` })
  assert.deepEqual(typeOnly.cycles, {})
})

test('래칫 — 새 순환, 순환에 들어온 새 파일, 두 묶음이 합쳐진 경우는 늘어난 것이다', () => {
  const none = valuesOf({ 's/a.ts': importing('./b.js'), 's/b.ts': `${HEAD}export const value0 = 1\n` })
  const pair = valuesOf({ 's/a.ts': importing('./b.js'), 's/b.ts': importing('./a.js') })
  assert.deepEqual(increasesAgainst(pair, none).increased, ['cycles s/a.ts', 'cycles s/b.ts'])
  assert.deepEqual(increasesAgainst(pair, pair).increased, [])

  const triple = valuesOf({ 's/a.ts': importing('./b.js'), 's/b.ts': importing('./c.js'), 's/c.ts': importing('./a.js') })
  assert.deepEqual(increasesAgainst(triple, pair).increased, ['cycles s/a.ts', 'cycles s/b.ts', 'cycles s/c.ts'])

  const twoPairs = { 's/a.ts': importing('./b.js'), 's/b.ts': importing('./a.js'), 's/c.ts': importing('./d.js'), 's/d.ts': importing('./c.js') }
  const merged = { ...twoPairs, 's/b.ts': importing('./a.js', './c.js'), 's/c.ts': importing('./d.js', './b.js') }
  assert.equal(increasesAgainst(valuesOf(merged), valuesOf(twoPairs)).increased.length, 4, '파일은 그대로인데 묶음이 4개짜리 하나가 됐다')

  const broken = increasesAgainst(none, pair)
  assert.deepEqual(broken.increased, [])
  assert.equal(broken.shrunkCells, 2)
})
