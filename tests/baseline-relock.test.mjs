// 재잠금 테스트 — 사유와 결정 ID 의 통제, 옮긴 파일 짝, 재잠금 이력을 본다.
// 대상: kit/lib/baseline.mjs 와 gate.mjs 의 --relock.
// 먼저 읽을 파일: helpers.mjs.
import assert from 'node:assert/strict'
import { appendFileSync, existsSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { compareValues, hasDecisionFile, planRelock, readLoggedLock } from '../kit/lib/baseline.mjs'
import { commitAll, gate, makeProject, planStubResult, readJson, stubCheck, writeFiles } from './helpers.mjs'

const DECISION = '2026-01-05-allow-growth'
const baselineFile = (dir, id = 'structure') => join(dir, 'scripts/lanekit/baselines', `${id}.json`)
const logFile = (dir) => join(dir, 'scripts/lanekit/baselines/relock-log.jsonl')
const readLog = (dir) => readFileSync(logFile(dir), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
const valuesOf = (cells) => ({ status: 'findings', current: { 'rule-a': cells } })

function makeLockedProject(cells) {
  const dir = makeProject({}, { [`docs/decisions/${DECISION}.md`]: '# 결정\n' })
  planStubResult(dir, 'structure', valuesOf(cells))
  return { dir, registry: [stubCheck('structure')] }
}

async function lockFirst(cells) {
  const project = makeLockedProject(cells)
  const first = await gate(project.dir, ['--relock', 'structure', '--reason', 'init'], project.registry)
  assert.equal(first.code, 0)
  return project
}

test('사유가 없으면 재잠금을 거절하고 아무것도 쓰지 않는다', async () => {
  const { dir, registry } = makeLockedProject({ 'src/a.ts': 2 })
  for (const argv of [['--relock', 'structure'], ['--relock', 'structure', '--reason', '  ']]) {
    const { code, output } = await gate(dir, argv, registry)
    assert.equal(code, 1)
    assert.match(output, /--reason "<사유>" 가 있어야 한다/)
  }
  assert.equal(existsSync(baselineFile(dir)), false)
  assert.equal(existsSync(logFile(dir)), false)
})

test('첫 잠금은 사유만으로 되고, 기준선과 이력 한 줄이 생긴다', async () => {
  const { dir } = await lockFirst({ 'src/a.ts': 2, 'src/b.ts': 1 })
  const baseline = readJson(baselineFile(dir))
  assert.equal(baseline.schema, 'lanekit-baseline/1')
  assert.deepEqual(baseline.values, { 'rule-a': { 'src/a.ts': 2, 'src/b.ts': 1 } })
  assert.ok(!Number.isNaN(Date.parse(baseline.lockedAt)))
  const [entry] = readLog(dir)
  assert.deepEqual(
    { check: entry.check, reason: entry.reason, decision: entry.decision, increased: entry.increased, before: entry.before, after: entry.after },
    { check: 'structure', reason: 'init', decision: null, increased: false, before: {}, after: { 'rule-a': 3 } },
  )
})

test('값이 줄거나 같으면 사유만으로 다시 잠근다', async () => {
  const { dir, registry } = await lockFirst({ 'src/a.ts': 2, 'src/b.ts': 1 })
  planStubResult(dir, 'structure', valuesOf({ 'src/a.ts': 1 }))
  const { code } = await gate(dir, ['--relock', 'structure', '--reason', '함수를 나눴다'], registry)
  assert.equal(code, 0)
  assert.deepEqual(readJson(baselineFile(dir)).values, { 'rule-a': { 'src/a.ts': 1 } })
  assert.deepEqual(readLog(dir).at(-1).before, { 'rule-a': 3 })
  assert.deepEqual(readLog(dir).at(-1).after, { 'rule-a': 1 })
})

test('값이 늘면 결정 ID 없이는 거절한다', async () => {
  const { dir, registry } = await lockFirst({ 'src/a.ts': 2 })
  planStubResult(dir, 'structure', valuesOf({ 'src/a.ts': 3 }))
  const attempts = [
    ['--reason', '늘었다'],
    ['--reason', '늘었다', '--allow-increase'],
    ['--reason', '늘었다', '--decision', DECISION],
  ]
  for (const extra of attempts) {
    const { code, output } = await gate(dir, ['--relock', 'structure', ...extra], registry)
    assert.equal(code, 1, extra.join(' '))
    assert.match(output, /--allow-increase --decision <ID> 가 있어야 한다/)
    assert.match(output, /\+ \[rule-a\] src\/a\.ts 2 -> 3/)
  }
  assert.deepEqual(readJson(baselineFile(dir)).values, { 'rule-a': { 'src/a.ts': 2 } })
  assert.equal(readLog(dir).length, 1)
})

test('결정 파일이 없는 ID 는 거절한다. 경로를 벗어나는 ID 도 거절한다', async () => {
  const { dir, registry } = await lockFirst({ 'src/a.ts': 2 })
  planStubResult(dir, 'structure', valuesOf({ 'src/a.ts': 3 }))
  for (const decision of ['2026-02-02-nope', '../../lanekit.config.json']) {
    const { code, output } = await gate(dir, ['--relock', 'structure', '--reason', '늘었다', '--allow-increase', '--decision', decision], registry)
    assert.equal(code, 1)
    assert.match(output, /docs\/decisions\/ 에 결정 파일이 없다/)
  }
})

test('결정 파일이 있으면 늘어난 값을 잠그고 이력에 결정 ID 를 남긴다', async () => {
  const { dir, registry } = await lockFirst({ 'src/a.ts': 2 })
  const commit = commitAll(dir)
  planStubResult(dir, 'structure', valuesOf({ 'src/a.ts': 3 }))
  const { code } = await gate(dir, ['--relock', 'structure', '--reason', '늘었다', '--allow-increase', '--decision', DECISION], registry)
  assert.equal(code, 0)
  assert.deepEqual(readJson(baselineFile(dir)).values, { 'rule-a': { 'src/a.ts': 3 } })
  const entry = readLog(dir).at(-1)
  assert.equal(entry.decision, DECISION)
  assert.equal(entry.increased, true)
  assert.equal(entry.commit, commit)
})

test('옮긴 파일 짝(--moves)은 묶음의 합이 늘지 않으면 증가가 아니다', async () => {
  const { dir, registry } = await lockFirst({ 'src/big.ts': 5, 'src/big.ts#render': 3 })
  writeFiles(dir, { 'moves.json': [{ from: 'src/big.ts', to: ['src/part-a.ts', 'src/part-b.ts'] }] })
  planStubResult(dir, 'structure', valuesOf({ 'src/part-a.ts': 4, 'src/part-b.ts#render': 4 }))
  const withoutMoves = await gate(dir, ['--relock', 'structure', '--reason', '파일을 나눴다'], registry)
  assert.equal(withoutMoves.code, 1, '짝을 알리지 않으면 새 파일이라 증가다')
  const withMoves = await gate(dir, ['--relock', 'structure', '--reason', '파일을 나눴다', '--moves', 'moves.json'], registry)
  assert.equal(withMoves.code, 0)

  planStubResult(dir, 'structure', valuesOf({ 'src/part-a.ts': 4, 'src/part-b.ts#render': 4, 'src/part-c.ts': 1 }))
  writeFiles(dir, { 'moves.json': [{ from: 'src/part-a.ts', to: ['src/part-a.ts', 'src/part-c.ts'] }] })
  const grown = await gate(dir, ['--relock', 'structure', '--reason', '또 나눴다', '--moves', 'moves.json'], registry)
  assert.equal(grown.code, 1, '묶음의 합이 4 에서 5 로 늘었다')
  assert.match(grown.output, /src\/part-a\.ts -> src\/part-a\.ts -> src\/part-c\.ts 4 -> 5/)
})

test('--moves 파일의 모양이 틀리면 사용법 오류(2)다', async () => {
  const { dir, registry } = await lockFirst({ 'src/a.ts': 1 })
  for (const moves of [{ from: 'src/a.ts' }, [{ from: 'src/a.ts', to: [7] }]]) {
    writeFiles(dir, { 'moves.json': moves })
    assert.equal((await gate(dir, ['--relock', 'structure', '--reason', 'x', '--moves', 'moves.json'], registry)).code, 2)
  }
})

test('--moves 에 같은 from 을 두 번 적어 상한을 두 번 쓰면, 결정 ID 없이는 거절한다', async () => {
  const { dir, registry } = await lockFirst({ 'src/old.ts': 900 })
  planStubResult(dir, 'structure', valuesOf({ 'src/new1.ts': 900, 'src/new2.ts': 900 }))
  writeFiles(dir, { 'moves.json': [{ from: 'src/old.ts', to: ['src/new1.ts'] }, { from: 'src/old.ts', to: ['src/new2.ts'] }] })
  const relock = (...extra) => gate(dir, ['--relock', 'structure', '--reason', '나눴다', '--moves', 'moves.json', ...extra], registry)
  const refused = await relock()
  assert.equal(refused.code, 1)
  assert.match(refused.output, /--moves 의 두 옮김에 같은 파일이 나온다/)
  assert.match(refused.output, /\+ \[rule-a\] src\/new1\.ts 0 -> 900/, '겹친 옮김은 쓰지 않고 파일마다 견준다')
  assert.deepEqual(readJson(baselineFile(dir)).values, { 'rule-a': { 'src/old.ts': 900 } })
  assert.equal((await relock('--allow-increase', '--decision', DECISION)).code, 0)
  const entry = readLog(dir).at(-1)
  assert.deepEqual([entry.increased, entry.decision], [true, DECISION], '이력에 증가와 결정 ID 가 남는다')
})

test('이력 끝에 파일별 값이 없는 줄을 덧붙여도 합계 비교로 내려가지 않는다. 결정 ID 가 있어야 다시 잠근다', async () => {
  const { dir, registry } = await lockFirst({ 'src/a.ts': 1500 })
  const shifted = { 'src/a.ts': 600, 'src/new.ts': 900 }
  planStubResult(dir, 'structure', valuesOf(shifted))
  appendFileSync(logFile(dir), `${JSON.stringify({ at: '2026-01-02T00:00:00Z', check: 'structure', reason: 'x', increased: false, after: { 'rule-a': 1500 } })}\n`)
  writeFiles(dir, { 'scripts/lanekit/baselines/structure.json': { schema: 'lanekit-baseline/1', check: 'structure', lockedAt: '2026-01-01T00:00:00Z', commit: 'x', values: { 'rule-a': shifted } } })
  const refused = await gate(dir, ['--relock', 'structure', '--reason', '다시'], registry)
  assert.equal(refused.code, 1)
  assert.match(refused.output, /재잠금 이력의 마지막 줄에 파일별 값이 없어서 늘었는지 견줄 수 없다/)
  const allowed = await gate(dir, ['--relock', 'structure', '--reason', '다시', '--allow-increase', '--decision', DECISION], registry)
  assert.equal(allowed.code, 0)
  const entry = readLog(dir).at(-1)
  assert.deepEqual([entry.increased, entry.decision, entry.values], [true, DECISION, { 'rule-a': shifted }])
})

test('planRelock — 옮김이 겹치면 증가가 보이지 않아도 결정 ID 를 요구한다', () => {
  const baseline = { values: { lines: { 'src/old.ts': 900, 'src/other.ts': 900 } } }
  const planFor = (current, moves, extra = {}) => planRelock({ current: { lines: current }, baseline, request: { reason: 'x', moves, ...extra }, decisionExists: true })
  const split = { 'src/new1.ts': 900, 'src/new2.ts': 900 }
  assert.equal(planFor(split, [{ from: 'src/old.ts', to: ['src/new1.ts', 'src/new2.ts'] }]).refusal, 'increase-needs-decision')
  const overlaps = [
    [{ from: 'src/old.ts', to: ['src/new1.ts'] }, { from: 'src/old.ts', to: ['src/new2.ts'] }],
    [{ from: 'src/old.ts', to: ['src/new1.ts'] }, { from: 'src/other.ts', to: ['src/new1.ts'] }],
    [{ from: 'src/old.ts', to: ['src/other.ts'] }, { from: 'src/other.ts', to: ['src/new1.ts'] }],
  ]
  for (const moves of overlaps) {
    const plan = planFor({ 'src/new1.ts': 1 }, moves)
    assert.deepEqual([plan.accepted, plan.refusal, plan.increased], [false, 'moves-overlap', true], JSON.stringify(moves))
  }
  assert.equal(planFor(split, overlaps[0], { allowIncrease: true, decision: 'd' }).accepted, true)
  const keepsFrom = [{ from: 'src/old.ts', to: ['src/old.ts', 'src/new1.ts'] }]
  assert.equal(planFor({ 'src/old.ts': 400, 'src/new1.ts': 500, 'src/other.ts': 900 }, keepsFrom).accepted, true, 'from 을 자기 to 에 다시 적는 것은 겹침이 아니다')
})

test('planRelock — 옮김이 있는데 규칙 합계가 늘면 증가다', () => {
  // 옮김은 값을 옮길 뿐 늘리지 못한다는 불변식이다. 묶음 비교가 먼저 잡는 경우에도, 어떤 옮김 목록으로든 합계가 늘면 받아들이지 않아야 한다.
  const baseline = { values: { lines: { 'src/old.ts': 900 } } }
  const logged = { values: { lines: { 'src/old.ts': 5000 } } }
  const moves = [{ from: 'src/old.ts', to: ['src/new.ts'] }]
  const request = { reason: 'x', moves }
  const grown = planRelock({ current: { lines: { 'src/new.ts': 901 } }, baseline, request, logged })
  assert.equal(grown.refusal, 'increase-needs-decision')
  const sameTotal = planRelock({ current: { lines: { 'src/new.ts': 900 } }, baseline, request, logged })
  assert.equal(sameTotal.accepted, true)
  const shuffled = [{ from: 'src/old.ts', to: ['src/new.ts'] }, { from: 'src/absent.ts', to: ['src/extra.ts'] }]
  const hidden = planRelock({ current: { lines: { 'src/new.ts': 900, 'src/extra.ts': 1 } }, baseline, request: { reason: 'x', moves: shuffled }, logged })
  assert.equal(hidden.accepted, false)
  const emptyMoved = planRelock({ current: { lines: { 'src/new.ts': 0, 'src/x.ts': 0 } }, baseline, request: { reason: 'x', moves: [{ from: 'src/gone.ts', to: ['src/new.ts'] }] } })
  assert.equal(emptyMoved.accepted, true)
})

test('--relock all 은 하나라도 거절되면 아무것도 쓰지 않는다', async () => {
  const dir = makeProject({})
  const registry = [stubCheck('structure'), stubCheck('writing'), stubCheck('docs-drift', { ratchetable: false })]
  planStubResult(dir, 'structure', valuesOf({ 'src/a.ts': 1 }))
  planStubResult(dir, 'writing', valuesOf({ 'docs/a.md': 1 }))
  assert.equal((await gate(dir, ['--relock', 'all', '--reason', 'init'], registry)).code, 0)
  assert.equal(existsSync(baselineFile(dir, 'docs-drift')), false, '기준선을 쓰지 않는 검사는 all 에서 빠진다')

  planStubResult(dir, 'structure', valuesOf({}))
  planStubResult(dir, 'writing', valuesOf({ 'docs/a.md': 2 }))
  const { code, output } = await gate(dir, ['--relock', 'all', '--reason', '다시'], registry)
  assert.equal(code, 1)
  assert.match(output, /거절된 검사가 있어 아무것도 쓰지 않았다/)
  assert.deepEqual(readJson(baselineFile(dir)).values, { 'rule-a': { 'src/a.ts': 1 } })
  assert.equal(readLog(dir).length, 2)
})

test('기준선을 쓰지 않는 검사나 모르는 검사를 재잠금하면 사용법 오류(2)다', async () => {
  const dir = makeProject({})
  const registry = [stubCheck('docs-drift', { ratchetable: false })]
  assert.equal((await gate(dir, ['--relock', 'docs-drift', '--reason', 'x'], registry)).code, 2)
  assert.equal((await gate(dir, ['--relock', 'nope', '--reason', 'x'], registry)).code, 2)
})

test('검사가 값을 내지 않으면 재잠금을 거절한다. 직접 고른 검사가 건너뛰어도 거절한다', async () => {
  const dir = makeProject({})
  planStubResult(dir, 'structure', { status: 'pass' })
  const empty = await gate(dir, ['--relock', 'structure', '--reason', 'init'], [stubCheck('structure')])
  assert.equal(empty.code, 1)
  assert.match(empty.output, /검사가 기준선으로 쓸 값을 내지 않았다/)
  planStubResult(dir, 'structure', { status: 'skip', summary: '잴 것이 없다' })
  const skipped = await gate(dir, ['--relock', 'structure', '--reason', 'init'], [stubCheck('structure')])
  assert.equal(skipped.code, 1)
  assert.match(skipped.output, /검사가 건너뛰어 잠글 값이 없다: 잴 것이 없다/)
  assert.equal(existsSync(baselineFile(dir)), false)
})

test('--relock all 은 건너뛴 검사를 거절하지 않고, 그 검사만 빼고 잠근 뒤 알린다', async () => {
  const dir = makeProject({})
  const registry = [stubCheck('structure'), stubCheck('writing')]
  planStubResult(dir, 'structure', { status: 'skip', summary: '모듈을 켜지 않았다' })
  planStubResult(dir, 'writing', valuesOf({ 'docs/a.md': 1 }))
  const { code, output } = await gate(dir, ['--relock', 'all', '--reason', 'init'], registry)
  assert.equal(code, 0)
  assert.match(output, /- structure: 건너뜀\. 검사가 돌지 않아 잠그지 않았다: 모듈을 켜지 않았다/)
  assert.match(output, /✓ writing: 기준선을 잠갔다/)
  assert.equal(existsSync(baselineFile(dir, 'structure')), false)
  assert.equal(existsSync(baselineFile(dir, 'writing')), true)
  assert.deepEqual(readLog(dir).map((entry) => entry.check), ['writing'])

  planStubResult(dir, 'writing', { status: 'skip', summary: '문서가 없다' })
  const nothing = await gate(dir, ['--relock', 'all', '--reason', '다시'], registry)
  assert.equal(nothing.code, 0)
  assert.match(nothing.output, /잠근 검사가 없다/)
  assert.equal(readLog(dir).length, 1, '잠근 것이 없으면 이력도 쓰지 않는다')
})

test('재잠금 때 검사는 ctx.relock 을 받고, relockValues 를 내면 판정은 current 로 하고 기준선에는 relockValues 를 쓴다', async () => {
  const { dir, registry } = await lockFirst({ 'src/a.ts#oldName': 2 })
  assert.equal(readJson(registry[0].seenFile).relock, true)
  assert.equal((await gate(dir, ['--no-evidence'], registry)).code, 0)
  assert.equal(readJson(registry[0].seenFile).relock, false, '프로필 실행에서는 relock 이 거짓이다')

  planStubResult(dir, 'structure', { ...valuesOf({ 'src/a.ts#oldName': 2 }), relockValues: { 'rule-a': { 'src/a.ts#newName': 2 } } })
  const { code } = await gate(dir, ['--relock', 'structure', '--reason', '함수 이름을 바꿨다'], registry)
  assert.equal(code, 0, '판정은 옛 키의 current 로 하므로 늘어난 칸이 없다')
  assert.deepEqual(readJson(baselineFile(dir)).values, { 'rule-a': { 'src/a.ts#newName': 2 } })

  planStubResult(dir, 'structure', { ...valuesOf({ 'src/a.ts#newName': 2 }), relockValues: { 'rule-a': { 'src/a.ts#newName': 9 } } })
  const mismatched = await gate(dir, ['--relock', 'structure', '--reason', '합계가 다르다'], registry)
  assert.equal(mismatched.code, 1, '판정한 값과 합계가 다른 relockValues 는 잠그지 않는다')
  assert.deepEqual(readJson(baselineFile(dir)).values, { 'rule-a': { 'src/a.ts#newName': 2 } })
})

test('기준선 파일을 지우거나 비워도, 이력의 마지막 값보다 늘면 결정 ID 없이는 거절한다', async () => {
  const { dir, registry } = await lockFirst({ 'src/a.ts': 2 })
  planStubResult(dir, 'structure', valuesOf({ 'src/a.ts': 5 }))
  const relock = () => gate(dir, ['--relock', 'structure', '--reason', '다시'], registry)
  rmSync(baselineFile(dir))
  const deleted = await relock()
  assert.equal(deleted.code, 1)
  assert.match(deleted.output, /\+ \[rule-a\] src\/a\.ts 2 -> 5/)
  assert.equal(existsSync(baselineFile(dir)), false)
  writeFiles(dir, { 'scripts/lanekit/baselines/structure.json': { schema: 'lanekit-baseline/1', check: 'structure', lockedAt: '2026-01-01T00:00:00Z', commit: 'x', values: {} } })
  assert.equal((await relock()).code, 1, '값을 비운 기준선')
  planStubResult(dir, 'structure', valuesOf({ 'src/a.ts': 2 }))
  assert.equal((await relock()).code, 0, '늘지 않았으면 사유만으로 잠근다')
})

test('한 파일을 줄이고 다른 파일을 늘려 합계를 맞춰도, 기준선을 지운 뒤 사유만으로는 잠글 수 없다', async () => {
  const { dir, registry } = await lockFirst({ 'src/a.ts': 1500 })
  assert.deepEqual(readLog(dir)[0].values, { 'rule-a': { 'src/a.ts': 1500 } }, '이력에 파일별 값 전체가 남는다')
  const shifted = { 'src/a.ts': 600, 'src/new.ts': 900 }
  planStubResult(dir, 'structure', valuesOf(shifted))
  const relock = () => gate(dir, ['--relock', 'structure', '--reason', '다시'], registry)
  rmSync(baselineFile(dir))
  const deleted = await relock()
  assert.equal(deleted.code, 1)
  assert.match(deleted.output, /\+ \[rule-a\] src\/new\.ts 0 -> 900/)
  writeFiles(dir, { 'scripts/lanekit/baselines/structure.json': { schema: 'lanekit-baseline/1', check: 'structure', lockedAt: '2026-01-01T00:00:00Z', commit: 'x', values: { 'rule-a': shifted } } })
  assert.equal((await relock()).code, 1, '기준선을 손으로 지금 값에 맞춰도 이력의 값으로 견준다')
  const allowed = await gate(dir, ['--relock', 'structure', '--reason', '나눴다', '--allow-increase', '--decision', DECISION], registry)
  assert.equal(allowed.code, 0)
  assert.deepEqual(readLog(dir).at(-1).values, { 'rule-a': shifted })
  assert.deepEqual(readLoggedLock(dir, 'structure').values, { 'rule-a': shifted })
})

test('planRelock — 기준선과 이력의 값 가운데 칸마다 더 작은 쪽과 견준다', () => {
  const request = { reason: 'x', moves: [] }
  const current = { lines: { 'src/a.ts': 600, 'src/new.ts': 900 } }
  const logged = { values: { lines: { 'src/a.ts': 1500 } }, sums: { lines: 1500 } }
  const plan = planRelock({ current, baseline: null, request, logged })
  assert.equal(plan.refusal, 'increase-needs-decision')
  assert.deepEqual(plan.increases, [{ rule: 'lines', key: 'src/new.ts', from: 0, to: 900 }])
  const edited = { values: { lines: { 'src/a.ts': 600, 'src/new.ts': 900 } } }
  assert.equal(planRelock({ current, baseline: edited, request, logged }).accepted, false, '손으로 올린 기준선')
  const lowered = { values: { lines: { 'src/a.ts': 100 } } }
  const strict = planRelock({ current: { lines: { 'src/a.ts': 200 } }, baseline: lowered, request, logged })
  assert.deepEqual(strict.increases, [{ rule: 'lines', key: 'src/a.ts', from: 100, to: 200 }], '기준선이 더 낮으면 기준선과 견준다')
  const withoutValues = planRelock({ current, baseline: null, request, logged: { values: null } })
  assert.deepEqual([withoutValues.accepted, withoutValues.refusal, withoutValues.increased], [false, 'log-without-values', true], '파일별 값이 없는 이력 줄은 받지 않는다')
  assert.equal(planRelock({ current, baseline: null, request, logged: null }).accepted, true, '이력도 기준선도 없는 첫 잠금')
})

test('옮기기 전 파일이 남아 있으면 --moves 로 증가를 숨길 수 없다', () => {
  const base = { lines: { 'src/a.ts': 900 } }
  const moves = [{ from: 'src/a.ts', to: ['src/b.ts'] }]
  const kept = compareValues({ lines: { 'src/a.ts': 900, 'src/b.ts': 900 } }, base, moves)
  assert.deepEqual(kept.increases, [{ rule: 'lines', key: 'src/a.ts -> src/b.ts', from: 900, to: 1800 }])
  assert.deepEqual(compareValues({ lines: { 'src/a.ts': 400, 'src/b.ts': 500 } }, base, moves).increases, [], '나눠서 합이 그대로면 증가가 아니다')
})

test('결정 ID 는 내용이 있는 파일이어야 한다. 폴더 · 빈 파일 · 안내 파일 · 틀은 받지 않는다', () => {
  const dir = makeProject({}, {
    'docs/decisions/README.md': '# 결정 기록\n',
    'docs/decisions/0000-template.md': '# 틀\n',
    'docs/decisions/empty.md': '',
    'docs/decisions/blank.md': ' \n\t\n',
    'outside-note.md': '# 저장소의 다른 글\n',
    [`docs/decisions/${DECISION}.md`]: '# 결정\n',
  })
  symlinkSync(join(dir, 'outside-note.md'), join(dir, 'docs/decisions/linked.md'))
  assert.equal(hasDecisionFile(dir, DECISION), true)
  for (const decision of ['.', '..', 'README', 'README.md', 'readme', '0000-template', 'empty', 'blank', 'linked', 'nope', '../decisions/' + DECISION, null]) {
    assert.equal(hasDecisionFile(dir, decision), false, String(decision))
  }
})

test('재잠금한 뒤 ratchet 모드의 게이트가 그 기준선으로 판정한다', async () => {
  const { dir, registry } = await lockFirst({ 'src/a.ts': 2 })
  writeFiles(dir, { 'lanekit.config.json': { checks: { structure: { mode: 'ratchet' } } } })
  assert.equal((await gate(dir, ['--no-evidence'], registry)).code, 0)
  planStubResult(dir, 'structure', valuesOf({ 'src/a.ts': 3 }))
  assert.equal((await gate(dir, ['--no-evidence'], registry)).code, 1)
  assert.deepEqual(readJson(registry[0].seenFile).baseline, { 'rule-a': { 'src/a.ts': 2 } }, '검사는 ctx.baseline 으로 기준선 값을 받는다')
})

test('compareValues — 함수 단위 키(파일#함수)와 규칙별 비교', () => {
  const base = { lines: { 'src/a.ts#load': 70, 'src/a.ts#save': 65 }, count: { 'src/a.ts': 1 } }
  assert.deepEqual(compareValues(base, base).increases, [])
  const grown = compareValues({ lines: { 'src/a.ts#load': 71 }, count: {} }, base)
  assert.deepEqual(grown.increases, [{ rule: 'lines', key: 'src/a.ts#load', from: 70, to: 71 }])
  const moved = compareValues({ lines: { 'src/b.ts#load': 70, 'src/c.ts#save': 65 }, count: {} }, base, [{ from: 'src/a.ts', to: ['src/b.ts', 'src/c.ts'] }])
  assert.deepEqual(moved.increases, [])
  assert.deepEqual(compareValues({ fresh: { 'src/a.ts': 9 } }, base).newRules, ['fresh'])
})

test('planRelock — 거절 사유의 순서', () => {
  const baseline = { values: { 'rule-a': { 'src/a.ts': 1 } } }
  const grown = { 'rule-a': { 'src/a.ts': 2 } }
  const refusalOf = (request, decisionExists = false) =>
    planRelock({ current: grown, baseline, request: { moves: [], ...request }, decisionExists }).refusal
  assert.equal(refusalOf({ reason: '' }), 'reason-missing')
  assert.equal(refusalOf({ reason: 'x' }), 'increase-needs-decision')
  assert.equal(refusalOf({ reason: 'x', allowIncrease: true }), 'increase-needs-decision')
  assert.equal(refusalOf({ reason: 'x', allowIncrease: true, decision: 'd' }), 'decision-not-found')
  assert.equal(refusalOf({ reason: 'x', allowIncrease: true, decision: 'd' }, true), undefined)
  assert.equal(planRelock({ current: grown, baseline: null, request: { reason: 'init', moves: [] } }).accepted, true)
})
