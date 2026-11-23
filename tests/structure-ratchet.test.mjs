// 구조 래칫 테스트 — 허용 폭, 이름이 바뀐 함수, 새 파일 · 새 함수, 재잠금과 옮긴 파일 짝을 본다.
// 대상: kit/checks/structure/ 의 ratchet.mjs · relock.mjs 와, 그 값을 견주는 실행기(kit/lib/baseline.mjs · gate.mjs).
// 먼저 읽을 파일: structure-helpers.mjs 의 valuesOf · increasesAgainst.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { gate, makeProject, readJson, writeFiles } from './helpers.mjs'
import { constLines, fnSource, increasesAgainst, runStructure, structureConfig, useTypescript, valuesOf } from './structure-helpers.mjs'

useTypescript()

const HEAD = '// 머리 주석\n'
const FILE = 'src/svc/a.ts'
const OTHER = 'src/svc/b.ts'
const big = (name, lineCount) => valuesOf({ [FILE]: HEAD + fnSource(name, lineCount) })
const complexFn = (branches) => `${HEAD}export function decide(flag) {\n${Array.from({ length: branches }, () => '  if (flag) flag()').join('\n')}\n}\n`

test('이미 상한을 넘은 함수는 10줄까지 늘어도 통과하고, 넘으면 실패하고, 줄면 통과한다', () => {
  const base = big('big', 150)
  assert.deepEqual(base.fnLines, { [`${FILE}#big`]: 152 })
  assert.deepEqual(increasesAgainst(big('big', 150), base).increased, [])
  const withinSlack = increasesAgainst(big('big', 160), base)
  assert.deepEqual(withinSlack.increased, [])
  assert.equal(withinSlack.current.fnLines[`${FILE}#big`], 152, '허용 폭 안의 증가는 기준선 값으로 적는다')
  const grown = increasesAgainst(big('big', 161), base)
  assert.deepEqual(grown.increased, [`fnLines ${FILE}#big`])
  assert.deepEqual([grown.increases[0].from, grown.increases[0].to], [152, 163])
  const shrunk = increasesAgainst(big('big', 120), base)
  assert.deepEqual(shrunk.increased, [])
  assert.equal(shrunk.shrunkCells, 1)
})

test('새 함수는 상한을 지켜야 하고, 이름만 바뀐 함수는 기준선의 칸으로 맞춘다', () => {
  const base = big('big', 150)
  const withFresh = (lineCount) => valuesOf({ [FILE]: HEAD + fnSource('big', 150) + fnSource('fresh', lineCount) })
  assert.deepEqual(increasesAgainst(withFresh(99), base).increased, [`fnLines ${FILE}#fresh`], '101줄인 새 함수')
  assert.deepEqual(increasesAgainst(withFresh(98), base).increased, [])
  const renamed = increasesAgainst(big('renamedBig', 150), base)
  assert.deepEqual(renamed.increased, [])
  assert.deepEqual(renamed.renames, [{ file: FILE, from: 'big', to: 'renamedBig' }])
  assert.deepEqual(Object.keys(renamed.current.fnLines), [`${FILE}#big`])
  assert.deepEqual(renamed.relockValues.fnLines, { [`${FILE}#renamedBig`]: 152 }, '재잠금 때 기준선에는 지금 이름으로 적는다')
  const renamedWithinSlack = increasesAgainst(big('renamedBig', 160), base)
  assert.equal(renamedWithinSlack.relockValues.fnLines[`${FILE}#renamedBig`], 152, '허용 폭 안의 증가는 재잠금해도 쌓이지 않는다')
  assert.deepEqual(increasesAgainst(big('renamedBig', 161), base).increased, [`fnLines ${FILE}#renamedBig`], '이름을 바꾸면서 허용 폭보다 더 늘었다')
})

test('이름이 바뀐 함수는 한 번만 짝짓는다', () => {
  const base = big('big', 150)
  const twoBig = valuesOf({ [FILE]: HEAD + fnSource('first', 150) + fnSource('second', 150) })
  const compared = increasesAgainst(twoBig, base)
  assert.deepEqual(compared.renames, [{ file: FILE, from: 'big', to: 'first' }])
  assert.deepEqual(compared.increased, [`fnLines ${FILE}#second`])
})

test('새 파일이 500줄을 넘으면 실패하고, 기존의 큰 파일은 20줄까지 늘어도 통과한다', () => {
  const small = valuesOf({ [FILE]: `${HEAD}export const first = 1\n` })
  const withLong = valuesOf({ [FILE]: `${HEAD}export const first = 1\n`, [OTHER]: HEAD + constLines(500) })
  assert.deepEqual(increasesAgainst(withLong, small).increased, [`fileLines ${OTHER}`])
  const base = valuesOf({ [FILE]: constLines(600) })
  assert.deepEqual(increasesAgainst(valuesOf({ [FILE]: constLines(620) }), base).increased, [])
  assert.deepEqual(increasesAgainst(valuesOf({ [FILE]: constLines(621) }), base).increased, [`fileLines ${FILE}`])
})

test('복잡도에는 허용 폭이 없다', () => {
  const base = valuesOf({ [FILE]: complexFn(20) })
  assert.deepEqual(base.complexity, { [`${FILE}#decide`]: 21 })
  assert.deepEqual(increasesAgainst(valuesOf({ [FILE]: complexFn(20) }), base).increased, [])
  assert.deepEqual(increasesAgainst(valuesOf({ [FILE]: complexFn(21) }), base).increased, [`complexity ${FILE}#decide`])
})

test('빈 catch 와 console 은 파일별로 늘면 실패하고, 다시 잠근 뒤에는 새 값이 기준이다', () => {
  const one = valuesOf({ [FILE]: `${HEAD}try { run() } catch {}\n` })
  const two = valuesOf({ [FILE]: `${HEAD}try { run() } catch {}\ntry { stop() } catch { /* 이유 */ }\nconsole.log(1)\n` })
  assert.deepEqual(increasesAgainst(two, one).increased.sort(), [`console ${FILE}`, `emptyCatch ${FILE}`])
  assert.deepEqual(increasesAgainst(two, two).increased, [])
  assert.ok(increasesAgainst(one, two).shrunkCells > 0)
})

test('기준선에 없는 규칙은 실패가 아니라 알림이다', () => {
  const values = valuesOf({ [FILE]: 'const d = 1\n' })
  const { shortIdentifiers, missingFileHeader, ...older } = values
  const compared = increasesAgainst(values, older)
  assert.deepEqual(compared.increased, [])
  assert.deepEqual(compared.newRules.sort(), ['missingFileHeader', 'shortIdentifiers'])
  assert.deepEqual([shortIdentifiers[FILE], missingFileHeader[FILE]], [1, 1])
})

test('옮긴 파일은 묶음의 합으로 견준다', () => {
  const base = valuesOf({ [FILE]: HEAD + constLines(1000) })
  const moves = [{ from: FILE, to: [FILE, OTHER] }]
  const split = (first, second) => valuesOf({ [FILE]: HEAD + constLines(first), [OTHER]: HEAD + constLines(second) })
  assert.deepEqual(increasesAgainst(split(600, 400), base, moves).increased, [], '둘째 파일은 상한 아래라 값에 없다')
  assert.deepEqual(increasesAgainst(valuesOf({ [OTHER]: HEAD + constLines(900) }), base, [{ from: FILE, to: [OTHER] }]).increased, [])
  const more = increasesAgainst(split(600, 600), base, moves)
  assert.deepEqual(more.increases.map((increase) => [increase.rule, increase.from, increase.to]), [['fileLines', 1001, 1202]])
  assert.deepEqual(increasesAgainst(split(600, 600), base).increased, [`fileLines ${OTHER}`], '짝을 알리지 않으면 새 파일이다')
})

test('옮긴 새 경로에 머리 주석이 없으면 늘어난 것이다', () => {
  const base = valuesOf({ [FILE]: `${HEAD}const d = 1\nconst q = 2\n` })
  const moves = [{ from: FILE, to: [FILE, OTHER] }]
  const split = valuesOf({ [FILE]: `${HEAD}const d = 1\n`, [OTHER]: `${HEAD}const q = 2\n` })
  assert.deepEqual(increasesAgainst(split, base, moves).increased, [], '짧은 이름 2개가 두 파일로 나뉘었다')
  const more = valuesOf({ [FILE]: `${HEAD}const d = 1\n`, [OTHER]: `${HEAD}const q = 2\nconst w = 3\n` })
  assert.deepEqual(increasesAgainst(more, base, moves).increases.map((increase) => [increase.rule, increase.from, increase.to]), [['shortIdentifiers', 2, 3]])
  const noHeader = valuesOf({ [FILE]: `${HEAD}const d = 1\n`, [OTHER]: 'const q = 2\n' })
  assert.deepEqual(increasesAgainst(noHeader, base, moves).increases.map((increase) => [increase.rule, increase.from, increase.to]), [['missingFileHeader', 0, 1]])
})

const baselineOf = (dir) => readJson(join(dir, 'scripts/lanekit/baselines/structure.json')).values
const relock = (dir, ...extra) => gate(dir, ['--relock', 'structure', '--reason', '테스트', ...extra])

test('게이트 — 잠근 뒤 ratchet 모드에서 같으면 통과하고 늘면 실패한다', async () => {
  const dir = makeProject(structureConfig(), { 'src/a.ts': HEAD + fnSource('big', 150) })
  assert.equal((await relock(dir)).code, 0)
  assert.deepEqual(baselineOf(dir).fnLines, { 'src/a.ts#big': 152 })
  writeFiles(dir, { 'lanekit.config.json': structureConfig({ mode: 'ratchet' }) })
  const same = await runStructure(dir)
  assert.equal(same.code, 0)
  assert.equal(same.outcome.reason, 'within-baseline')
  writeFiles(dir, { 'src/a.ts': HEAD + fnSource('big', 160) })
  assert.equal((await runStructure(dir)).code, 0, '허용 폭 안')
  writeFiles(dir, { 'src/a.ts': HEAD + fnSource('big', 161) })
  const grown = await runStructure(dir)
  assert.equal(grown.code, 1)
  assert.match(grown.output, /\+ \[fnLines\] src\/a\.ts#big 152 -> 163/)
  writeFiles(dir, { 'src/a.ts': HEAD + fnSource('big', 150), 'src/b.ts': fnSource('helper', 3) })
  const noHeader = await runStructure(dir)
  assert.equal(noHeader.code, 1, '새 파일에 머리 주석이 없다')
  assert.match(noHeader.output, /\+ \[missingFileHeader\] src\/b\.ts 0 -> 1/)
})

test('게이트 — ratchet 모드인데 기준선이 없으면 설정 오류(2)다', async () => {
  const dir = makeProject(structureConfig({ mode: 'ratchet' }), { 'src/a.ts': `${HEAD}export const a = 1\n` })
  assert.equal((await runStructure(dir)).code, 2)
})

test('게이트 — 허용 폭 안에서 늘어난 값은 다시 잠가도 기준선 값 그대로다', async () => {
  const dir = makeProject(structureConfig(), { 'src/a.ts': constLines(600) })
  await relock(dir)
  writeFiles(dir, { 'src/a.ts': constLines(615) })
  assert.equal((await relock(dir)).code, 0)
  assert.equal(baselineOf(dir).fileLines['src/a.ts'], 600, '허용 폭이 다시 잠글 때마다 쌓이지 않는다')
  writeFiles(dir, { 'src/a.ts': constLines(550) })
  assert.equal((await relock(dir)).code, 0)
  assert.equal(baselineOf(dir).fileLines['src/a.ts'], 550)
})

test('게이트 — 파일을 나눈 재잠금은 --moves 로 짝을 알려야 받아들인다', async () => {
  const dir = makeProject(structureConfig(), { 'src/a.ts': HEAD + constLines(1200) })
  await relock(dir)
  writeFiles(dir, { 'src/a.ts': HEAD + constLines(600), 'src/b.ts': HEAD + constLines(550), 'moves.json': [{ from: 'src/a.ts', to: ['src/a.ts', 'src/b.ts'] }] })
  const refused = await relock(dir)
  assert.equal(refused.code, 1)
  assert.match(refused.output, /\+ \[fileLines\] src\/b\.ts 0 -> 551/)
  assert.equal(baselineOf(dir).fileLines['src/a.ts'], 1201, '거절하면 기준선을 쓰지 않는다')
  const accepted = await relock(dir, '--moves', 'moves.json')
  assert.equal(accepted.code, 0)
  assert.deepEqual(baselineOf(dir).fileLines, { 'src/a.ts': 601, 'src/b.ts': 551 })
})
