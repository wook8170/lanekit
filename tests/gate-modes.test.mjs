// 모드 판정 테스트 — off · warn · ratchet · fail 의 판정, 프로필 고르기, 건너뛰기, 종료 코드를 본다.
// 대상: kit/gate.mjs · kit/lib/verdict.mjs · kit/lib/profile.mjs · kit/lib/args.mjs.
// 먼저 읽을 파일: helpers.mjs(가짜 검사를 놓는 법).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { effectiveMode, validateConfig } from '../kit/lib/config.mjs'
import { judge } from '../kit/lib/verdict.mjs'
import { copyFixture, finding, gate, makeProject, planStubResult, readJson, stubCheck, writeFiles } from './helpers.mjs'

const BASELINE = (values) => ({ schema: 'lanekit-baseline/1', check: 'structure', lockedAt: '2026-01-01T00:00:00.000Z', commit: 'no-git', values })
const withMode = (mode) => ({ checks: { structure: { mode } } })
const WITH_FINDING = { status: 'findings', findings: [finding('src/a.ts')], current: { 'rule-a': { 'src/a.ts': 1 } } }
const CLEAN = { status: 'pass', current: { 'rule-a': {} } }

async function runStructure(mode, result, extraFiles = {}) {
  const dir = makeProject(withMode(mode), extraFiles)
  if (result) planStubResult(dir, 'structure', result)
  return { dir, ...(await gate(dir, ['--no-evidence'], [stubCheck('structure')])) }
}

test('warn 모드는 찾은 것을 출력하고 통과시킨다', async () => {
  const { code, output } = await runStructure('warn', WITH_FINDING)
  assert.equal(code, 0)
  assert.match(output, /src\/a\.ts:1 \[rule-a\] stub finding/)
  assert.match(output, /경고만 낸다/)
})

test('fail 모드는 찾은 것이 하나라도 있으면 실패다', async () => {
  assert.equal((await runStructure('fail', WITH_FINDING)).code, 1)
  assert.equal((await runStructure('fail', CLEAN)).code, 0)
})

test('off 모드는 검사를 돌리지 않는다', async () => {
  // 가짜 검사의 결과 파일을 두지 않았다. 검사가 돌았다면 읽기 오류로 실패했을 것이다.
  const { code, output } = await runStructure('off', null)
  assert.equal(code, 0)
  assert.match(output, /structure\s+off\s+건너뜀\s+모드가 off 다/)
})

test('ratchet 모드인데 기준선이 없으면 설정 오류(2)다', async () => {
  const { code, output } = await runStructure('ratchet', CLEAN)
  assert.equal(code, 2)
  assert.match(output, /checks\.structure\.mode: ratchet 모드인데 기준선이 없다/)
})

const LOG_FILE = 'scripts/lanekit/baselines/relock-log.jsonl'
const logLine = (entry) => `${JSON.stringify({ at: '2026-01-01T00:00:00.000Z', check: 'structure', reason: 'init', ...entry })}\n`
// 게이트로 잠근 것과 같은 상태: 기준선 파일과, 같은 값을 남긴 재잠금 이력 한 줄.
const lockedAt = (values) => ({ 'scripts/lanekit/baselines/structure.json': BASELINE(values), [LOG_FILE]: logLine({ after: {}, values }) })

test('ratchet 모드는 기준선과 같거나 줄면 통과시킨다', async () => {
  const baseline = lockedAt({ 'rule-a': { 'src/a.ts': 2, 'src/b.ts': 1 } })
  const same = await runStructure('ratchet', { status: 'findings', findings: [finding('src/a.ts')], current: { 'rule-a': { 'src/a.ts': 2, 'src/b.ts': 1 } } }, baseline)
  assert.equal(same.code, 0)
  assert.match(same.output, /기준선 안/)
  const fewer = await runStructure('ratchet', { status: 'findings', current: { 'rule-a': { 'src/a.ts': 1 } } }, baseline)
  assert.equal(fewer.code, 0)
})

test('ratchet 모드는 어느 칸이든 늘면 실패다. 다른 칸이 줄어도 상쇄하지 않는다', async () => {
  const baseline = lockedAt({ 'rule-a': { 'src/a.ts': 2, 'src/b.ts': 5 } })
  const { code, output } = await runStructure('ratchet', { status: 'findings', current: { 'rule-a': { 'src/a.ts': 3, 'src/b.ts': 0 } } }, baseline)
  assert.equal(code, 1)
  assert.match(output, /\+ \[rule-a\] src\/a\.ts 2 -> 3/)
})

test('ratchet 모드에서 기준선에 없는 새 파일은 상한 0 이다', async () => {
  const baseline = lockedAt({ 'rule-a': { 'src/a.ts': 2 } })
  const { code, output } = await runStructure('ratchet', { status: 'findings', current: { 'rule-a': { 'src/a.ts': 2, 'src/new.ts': 1 } } }, baseline)
  assert.equal(code, 1)
  assert.match(output, /src\/new\.ts 0 -> 1/)
})

test('ratchet 모드에서 기준선에 없는 규칙은 실패가 아니라 알림이다', async () => {
  const baseline = lockedAt({ 'rule-a': {} })
  const { code, output } = await runStructure('ratchet', { status: 'findings', current: { 'rule-a': {}, 'rule-new': { 'src/a.ts': 4 } } }, baseline)
  assert.equal(code, 0)
  assert.match(output, /기준선에 없는 규칙: rule-new/)
})

test('ratchet 모드는 기준선 파일을 재잠금 이력보다 높게 고치면, 지금 값이 그 안에 들어도 실패다', async () => {
  const current = { status: 'findings', current: { 'rule-a': { 'src/a.ts': 600, 'src/new.ts': 900 } } }
  const raised = { ...lockedAt({ 'rule-a': { 'src/a.ts': 1500 } }), 'scripts/lanekit/baselines/structure.json': BASELINE(current.current) }
  const { code, output } = await runStructure('ratchet', current, raised)
  assert.equal(code, 1)
  assert.match(output, /재잠금 이력에 없는 증가가 있다/)
  assert.match(output, /\+ \[rule-a\] src\/new\.ts 0 -> 900/)
})

test('ratchet 모드는 재잠금 이력이 없는 기준선의 값을 믿지 않는다. 이력보다 낮춘 기준선은 그대로 쓴다', async () => {
  const baselineOnly = { 'scripts/lanekit/baselines/structure.json': BASELINE({ 'rule-a': { 'src/a.ts': 2 } }) }
  const withoutLog = await runStructure('ratchet', { status: 'pass', current: { 'rule-a': { 'src/a.ts': 1 } } }, baselineOnly)
  assert.equal(withoutLog.code, 1, '이력이 없으면 잠근 적이 없는 값이다')
  const lowered = { ...lockedAt({ 'rule-a': { 'src/a.ts': 5 } }), ...baselineOnly }
  assert.equal((await runStructure('ratchet', { status: 'findings', current: { 'rule-a': { 'src/a.ts': 2 } } }, lowered)).code, 0)
  assert.equal((await runStructure('ratchet', { status: 'findings', current: { 'rule-a': { 'src/a.ts': 3 } } }, lowered)).code, 1, '낮춘 기준선이 상한이다')
})

test('ratchet 모드는 기준선 파일에서 규칙을 지워도 이력의 값을 상한으로 쓴다', async () => {
  const logged = { 'rule-a': { 'src/a.ts': 600 }, 'rule-b': { 'src/a.ts#fn': 80 } }
  const withoutRule = { ...lockedAt(logged), 'scripts/lanekit/baselines/structure.json': BASELINE({ 'rule-b': logged['rule-b'] }) }
  const grown = { status: 'findings', current: { 'rule-a': { 'src/a.ts': 600, 'src/new.ts': 5000 }, 'rule-b': { 'src/a.ts#fn': 80 } } }
  const { code, output } = await runStructure('ratchet', grown, withoutRule)
  assert.equal(code, 1)
  assert.match(output, /\+ \[rule-a\] src\/new\.ts 0 -> 5000/)
  assert.equal((await runStructure('ratchet', { status: 'findings', current: logged }, withoutRule)).code, 0, '늘지 않았으면 통과한다')
})

test('ratchet 모드는 기준선 파일의 values 를 비워도 이력의 값을 상한으로 쓴다', async () => {
  const logged = { 'rule-a': { 'src/a.ts': 600 }, 'rule-b': { 'src/a.ts#fn': 80 } }
  const emptied = { ...lockedAt(logged), 'scripts/lanekit/baselines/structure.json': BASELINE({}) }
  const grown = { status: 'findings', current: { 'rule-a': { 'src/a.ts': 601 }, 'rule-b': { 'src/a.ts#fn': 80, 'src/b.ts#fn': 300 } } }
  const { code, output } = await runStructure('ratchet', grown, emptied)
  assert.equal(code, 1)
  assert.match(output, /\+ \[rule-a\] src\/a\.ts 600 -> 601/)
  assert.match(output, /\+ \[rule-b\] src\/b\.ts#fn 0 -> 300/)
  assert.doesNotMatch(output, /기준선에 없는 규칙/)
})

test('judge — 이력에 없는 기준선 증가를 파일별 값으로 찾는다. 파일별 값이 없는 이력 줄은 받지 않는다', () => {
  const result = { status: 'pass', findings: [], current: { lines: { 'src/a.ts': 1 } } }
  const baseline = { values: { lines: { 'src/a.ts': 4, 'src/b.ts': 0 } } }
  const reasonOf = (logged) => judge({ mode: 'ratchet', result, baseline, logged }).reason
  assert.equal(reasonOf({ values: { lines: { 'src/a.ts': 4 } } }), 'within-baseline')
  assert.equal(reasonOf(null), 'baseline-unlogged')
  assert.equal(reasonOf({ values: { lines: { 'src/a.ts': 3 } } }), 'baseline-unlogged')
  assert.equal(reasonOf({ values: { lines: { 'src/a.ts': 'x' } } }), 'baseline-unlogged', '숫자가 아닌 이력의 칸은 0 으로 본다')
  assert.equal(reasonOf({ values: {} }), 'baseline-unlogged', '이력에 없는 규칙')
  assert.equal(reasonOf({ values: null }), 'log-without-values', '합계로 내려가 견주지 않는다')
})

test('ratchet 모드는 이력 끝에 파일별 값이 없는 줄을 덧붙이면 실패하고, 결정 ID 로 다시 잠그라고 알린다', async () => {
  const cells = { 'rule-a': { 'src/a.ts': 600, 'src/new.ts': 900 } }
  const locked = lockedAt({ 'rule-a': { 'src/a.ts': 1500 } })
  const appended = { ...locked, 'scripts/lanekit/baselines/structure.json': BASELINE(cells), [LOG_FILE]: locked[LOG_FILE] + logLine({ after: { 'rule-a': 1500 } }) }
  const { code, output } = await runStructure('ratchet', { status: 'findings', current: cells }, appended)
  assert.equal(code, 1)
  assert.match(output, /재잠금 이력의 마지막 줄에 파일별 값이 없어서 기준선과 견줄 수 없다/)
  assert.match(output, /--allow-increase --decision <ID> 로 다시 잠근다/)
})

test('ratchet 모드에서 검사가 견줄 값을 내지 않으면 실패다', async () => {
  const { code } = await runStructure('ratchet', { status: 'findings', findings: [finding('src/a.ts')] }, lockedAt({ 'rule-a': {} }))
  assert.equal(code, 1)
})

test('기준선을 쓰지 않는 검사에 ratchet 모드를 주면 설정 오류(2)다', async () => {
  const dir = makeProject({ checks: { 'docs-drift': { mode: 'ratchet' } } })
  const { code, output } = await gate(dir, ['--no-evidence'], [stubCheck('docs-drift', { ratchetable: false })])
  assert.equal(code, 2)
  assert.match(output, /이 검사는 기준선을 쓰지 않는다/)
})

test('검사가 오류로 끝나면 warn 모드여도 실패다', async () => {
  assert.equal((await runStructure('warn', { status: 'error', summary: 'tool crashed' })).code, 1)
  const thrown = await runStructure('warn', { throws: 'boom' })
  assert.equal(thrown.code, 1)
  assert.match(thrown.output, /Error: boom/)
  assert.equal((await runStructure('warn', { status: 'ok' })).code, 1, '계약에 없는 status 는 오류다')
})

test('검사가 스스로 건너뛰면 fail 모드여도 통과다', async () => {
  const { code, output } = await runStructure('fail', { status: 'skip', summary: 'nothing to do' })
  assert.equal(code, 0)
  assert.match(output, /건너뜀/)
})

test('--skip 으로 건너뛴 검사는 skipped-by-flag 로 남는다', async () => {
  const dir = makeProject(withMode('fail'))
  const { code, output } = await gate(dir, ['--no-evidence', '--skip', 'structure'], [stubCheck('structure')])
  assert.equal(code, 0)
  assert.match(output, /skipped-by-flag/)
})

test('--only 는 고른 검사만 돌린다', async () => {
  const dir = makeProject({ checks: { structure: { mode: 'fail' }, writing: { mode: 'fail' } } })
  planStubResult(dir, 'structure', WITH_FINDING)
  planStubResult(dir, 'writing', CLEAN)
  const registry = [stubCheck('structure'), stubCheck('writing')]
  assert.equal((await gate(dir, ['--no-evidence'], registry)).code, 1)
  const onlyWriting = await gate(dir, ['--no-evidence', '--only', 'writing'], registry)
  assert.equal(onlyWriting.code, 0)
  assert.match(onlyWriting.output, /structure\s+fail\s+건너뜀\s+--only 에 없다/)
})

test('프로필에 없는 검사는 돌지 않는다', async () => {
  const dir = makeProject({ checks: { audit: { mode: 'fail' } } })
  planStubResult(dir, 'audit', WITH_FINDING)
  const registry = [stubCheck('audit', { profiles: ['full'], ratchetable: false })]
  const light = await gate(dir, ['--no-evidence'], registry)
  assert.equal(light.code, 0)
  assert.match(light.output, /이 프로필에서는 돌지 않는다/)
  assert.equal((await gate(dir, ['--no-evidence', '--profile', 'full'], registry)).code, 1)
})

test('검사 파일이 없으면 그 검사는 오류로 실패한다', async () => {
  const dir = makeProject(withMode('warn'))
  const { code, output } = await gate(dir, ['--no-evidence'], [{ id: 'structure', file: `${dir}/missing/run.mjs` }])
  assert.equal(code, 1)
  assert.match(output, /검사 파일이 없다: missing\/run\.mjs/)
})

test('모르는 검사 · 프로필 · 플래그는 사용법 오류(2)다', async () => {
  const dir = makeProject({})
  const registry = [stubCheck('structure')]
  for (const argv of [['--only', 'nope'], ['--skip', 'nope'], ['--profile', 'heavy'], ['--force']]) {
    const { code, output } = await gate(dir, argv, registry)
    assert.equal(code, 2, argv.join(' '))
    assert.match(output, /gate\.mjs --list/)
  }
})

test('환경 변수로는 검사를 건너뛸 수 없다', async () => {
  const dir = makeProject(withMode('fail'))
  planStubResult(dir, 'structure', WITH_FINDING)
  process.env.LANEKIT_SKIP = 'structure'
  try {
    assert.equal((await gate(dir, ['--no-evidence'], [stubCheck('structure')])).code, 1)
  } finally {
    delete process.env.LANEKIT_SKIP
  }
})

test('--list 는 등록된 검사와 모드를 낸다', async () => {
  const dir = makeProject({ repo: { visibility: 'public' } })
  const { code, output } = await gate(dir, ['--list'])
  assert.equal(code, 0)
  for (const id of ['structure', 'docs-drift', 'writing', 'secrets', 'exposure', 'guidance', 'wiki', 'tests', 'audit', 'sbom', 'provenance']) {
    assert.match(output, new RegExp(`^  ${id}\\s`, 'm'))
  }
  assert.match(output, /guidance\s+warn\s+light,changed,full · 기준선을 쓴다/)
  assert.match(output, /exposure\s+fail/, '공개 저장소의 exposure auto 는 fail 이다')
})

test('exposure 의 auto 모드는 공개 저장소면 fail, 아니면 off 다', () => {
  const modeFor = (visibility) => effectiveMode(validateConfig({ repo: { visibility } }).config, 'exposure')
  assert.equal(modeFor('public'), 'fail')
  assert.equal(modeFor('private'), 'off')
})

test('judge — 모드와 결과의 조합마다 판정이 정해져 있다', () => {
  const result = (status, findings = []) => ({ status, findings, current: null })
  const verdictOf = (mode, checkResult) => judge({ mode, result: checkResult, baseline: null }).verdict
  assert.equal(verdictOf('warn', result('pass')), 'pass')
  assert.equal(verdictOf('warn', result('findings', [finding('a')])), 'pass')
  assert.equal(verdictOf('fail', result('findings')), 'fail', 'status 가 findings 면 목록이 비어 있어도 실패다')
  assert.equal(verdictOf('fail', result('pass', [finding('a')])), 'fail', '목록이 있으면 status 가 pass 여도 실패다')
  assert.equal(verdictOf('fail', result('skip')), 'skip')
  assert.equal(verdictOf('warn', result('error')), 'fail')
})

test('설정을 영어로 두면 출력이 영어다', async () => {
  const dir = makeProject({ lang: 'en', ...withMode('warn') })
  planStubResult(dir, 'structure', WITH_FINDING)
  const { output } = await gate(dir, ['--no-evidence'], [stubCheck('structure')])
  assert.match(output, /warnings only/)
  writeFiles(dir, { 'lanekit.config.json': { lang: 'en', nope: true } })
  assert.match((await gate(dir, [], [stubCheck('structure')])).output, /nope: unknown key/)
})

test('kit 폴더만 프로젝트의 scripts/lanekit 로 복사해도 게이트가 돈다', () => {
  const dir = copyFixture()
  cpSync(fileURLToPath(new URL('../kit', import.meta.url)), join(dir, 'scripts', 'lanekit'), { recursive: true })
  const ran = spawnSync(process.execPath, ['scripts/lanekit/gate.mjs', '--only', 'guidance'], { cwd: dir, encoding: 'utf8' })
  assert.equal(ran.status, 0, ran.stderr)
  assert.match(ran.stdout, /guidance\s+warn\s+통과/)
  assert.equal(readJson(join(dir, '.lanekit/evidence/no-git-light-partial.json')).lanekit, 'unknown', '잠금 파일이 없으면 버전을 모른다')
  writeFiles(dir, { 'scripts/lanekit/lanekit.lock.json': { schema: 'lanekit-lock/1', version: '9.9.9', files: {} } })
  spawnSync(process.execPath, ['scripts/lanekit/gate.mjs', '--only', 'guidance'], { cwd: dir, encoding: 'utf8' })
  assert.equal(readJson(join(dir, '.lanekit/evidence/no-git-light-partial.json')).lanekit, '9.9.9')
})
