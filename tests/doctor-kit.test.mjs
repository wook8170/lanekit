// doctor 테스트(K · I1 ~ I3 · 실행부) — 설정 · 복사본 · 기준선 · 재잠금 이력 · 지침 파일을 보는 항목과, 출력 · 종료 코드를 본다.
// 대상: lib/doctor-checks/ 의 k1 ~ k5 · i1 ~ i3, lib/doctor.mjs.
// 먼저 읽을 파일: ../lib/doctor.mjs.
import assert from 'node:assert/strict'
import { appendFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import * as doctor from '../lib/doctor.mjs'
import { DOCTOR_CHECKS } from '../lib/doctor-checks/index.mjs'
import * as i1 from '../lib/doctor-checks/i1-guidance-size.mjs'
import * as i2 from '../lib/doctor-checks/i2-guidance-paths.mjs'
import * as i3 from '../lib/doctor-checks/i3-guidance-headings.mjs'
import * as k1 from '../lib/doctor-checks/k1-config-schema.mjs'
import * as k2 from '../lib/doctor-checks/k2-copy-intact.mjs'
import * as k3 from '../lib/doctor-checks/k3-kit-version.mjs'
import * as k4 from '../lib/doctor-checks/k4-baselines.mjs'
import * as k5 from '../lib/doctor-checks/k5-relock-log.mjs'
import * as k6 from '../lib/doctor-checks/k6-typescript.mjs'
import { STATUSES } from '../lib/doctor-checks/result.mjs'
import * as init from '../lib/init.mjs'
import { createCliTranslator } from '../lib/messages.mjs'
import { copyFixture, makeProject, makeTempDir, writeFiles } from './helpers.mjs'
import { FIXED_NOW, makeMachine, makeRepo, runCommandModule, runDoctorCheck, snapshotTree, VERSION } from './scaffold-helpers.mjs'

const machine = makeMachine()
const check = (checkModule, root, plugin) => runDoctorCheck(checkModule, root, machine, plugin)
const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = (days) => new Date(FIXED_NOW.getTime() - days * DAY_MS).toISOString()
const baselineFile = (id, lockedAt) => ({
  [`scripts/lanekit/baselines/${id}.json`]: { schema: 'lanekit-baseline/1', check: id, lockedAt, commit: 'abc', values: {} },
})

async function makeInstalledRepo() {
  const dir = makeRepo()
  await runCommandModule(init, { cwd: dir, argv: ['--yes'], machine })
  return dir
}

test('점검 항목은 25개이고 ID 가 겹치지 않으며, 제목 메시지가 두 언어에 있다', () => {
  const ids = DOCTOR_CHECKS.map((entry) => entry.meta.id)
  assert.equal(ids.length, 25)
  assert.equal(new Set(ids).size, 25)
  assert.deepEqual(ids, ['P1', 'P2', 'P3', 'P4', 'K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'G1', 'G2', 'G3', 'G4', 'G5', 'W1', 'W2', 'C1', 'I1', 'I2', 'I3', 'I4', 'E1', 'S1', 'S2'])
  for (const lang of ['ko', 'en']) {
    const translate = createCliTranslator(lang)
    for (const { meta } of DOCTOR_CHECKS) assert.notEqual(translate(meta.title), meta.title, `${lang} ${meta.title}`)
  }
})

test('K1: 설정이 없거나, JSON 이 아니거나, 스키마와 다르면 fail 이다', () => {
  assert.equal(check(k1, makeProject({ version: 1 })).status, 'ok')
  assert.equal(check(k1, makeTempDir()).status, 'fail')
  assert.match(check(k1, makeTempDir()).fix, /lanekit init/)
  assert.equal(check(k1, makeProject('{ not json')).status, 'fail')
  const invalid = check(k1, makeProject({ lang: 'fr', cheks: {} }))
  assert.equal(invalid.status, 'fail')
  assert.match(invalid.message, /cheks · unknown-key/)
  assert.match(invalid.message, /lang · not-allowed · ko \| en/)
})

test('K2: 복사본 하나를 고치면 그 파일을 warn 으로 내고, 빠진 파일은 fail 이다', async () => {
  const dir = await makeInstalledRepo()
  assert.equal(check(k2, dir).status, 'ok')
  appendFileSync(join(dir, 'scripts/lanekit/lib/report.mjs'), '\n// 프로젝트가 고친 줄\n')
  const modified = check(k2, dir)
  assert.equal(modified.status, 'warn')
  assert.match(modified.message, /lib\/report\.mjs/)
  assert.ok(!/gate\.mjs/.test(modified.message))
  rmSync(join(dir, 'scripts/lanekit/gate.mjs'))
  const missing = check(k2, dir)
  assert.equal(missing.status, 'fail')
  assert.match(missing.message, /gate\.mjs/)
  assert.equal(check(k2, makeTempDir()).status, 'fail', '복사본이 없는 저장소')
})

test('K3: 설치된 lanekit 이 복사본보다 새로우면 warn 이다', async () => {
  const dir = await makeInstalledRepo()
  assert.equal(check(k3, dir).status, 'ok')
  const newer = check(k3, dir, { version: '9.9.9' })
  assert.equal(newer.status, 'warn')
  assert.match(newer.message, new RegExp(`9\\.9\\.9.*${VERSION.replaceAll('.', '\\.')}`))
  assert.match(newer.fix, /\/lanekit:update/)
  assert.equal(check(k3, makeTempDir()).status, 'skip')
})

test('K4: ratchet 모드인데 기준선이 없으면 fail, 90일보다 오래됐으면 warn 이다', () => {
  const ratcheted = { checks: { guidance: { mode: 'ratchet' }, writing: { mode: 'ratchet' } } }
  assert.equal(check(k4, makeProject({})).status, 'ok', 'ratchet 인 검사가 없다')
  const absent = check(k4, makeProject(ratcheted, baselineFile('guidance', daysAgo(1))))
  assert.equal(absent.status, 'fail')
  assert.match(absent.message, /writing/)
  assert.ok(!/guidance/.test(absent.message))
  const fresh = { ...baselineFile('guidance', daysAgo(89)), ...baselineFile('writing', daysAgo(1)) }
  assert.equal(check(k4, makeProject(ratcheted, fresh)).status, 'ok')
  const stale = check(k4, makeProject(ratcheted, { ...fresh, ...baselineFile('guidance', daysAgo(91)) }))
  assert.equal(stale.status, 'warn')
  assert.match(stale.message, /guidance/)
  const broken = makeProject(ratcheted, { ...fresh, 'scripts/lanekit/baselines/writing.json': '{ broken' })
  assert.equal(check(k4, broken).status, 'fail', '깨진 기준선은 없는 것과 같다')
})

test('K4: 기준선의 나이는 잠근 시각으로 재고, 읽을 수 없는 시각은 오래된 것으로 본다', () => {
  assert.equal(k4.baselineAgeDays(daysAgo(10), FIXED_NOW), 10)
  assert.equal(k4.baselineAgeDays('언젠가', FIXED_NOW), Number.POSITIVE_INFINITY)
})

test('K5: 재잠금 이력에 사유 없는 줄이나 결정 ID 없는 증가가 있으면 warn 이다', () => {
  const logOf = (entries) => ({ 'scripts/lanekit/baselines/relock-log.jsonl': `${entries.map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry))).join('\n')}\n` })
  const good = { at: daysAgo(1), check: 'guidance', reason: 'init', decision: null, increased: false }
  const raised = { ...good, reason: '허용', decision: '2026-01-05-allow-growth', increased: true }
  assert.equal(check(k5, makeProject({})).status, 'ok', '이력이 아직 없다')
  assert.equal(check(k5, makeProject({}, logOf([good, raised]))).status, 'ok')
  const flagged = check(k5, makeProject({}, logOf([good, { ...good, reason: ' ' }, { ...raised, decision: null }, '{ broken'])))
  assert.equal(flagged.status, 'warn')
  assert.match(flagged.message, /2, 3, 4번 줄/)
})

test('K5: 기준선 파일을 게이트 없이 고치면 warn 이다. 이력에 없는 기준선도 같다', () => {
  const baseline = (cells) => JSON.stringify({ schema: 'lanekit-baseline/1', check: 'guidance', lockedAt: daysAgo(1), commit: 'abc', values: { size: cells } })
  const log = `${JSON.stringify({ at: daysAgo(1), check: 'guidance', reason: 'init', decision: null, increased: false, before: {}, after: { size: 3 }, values: { size: { 'AGENTS.md': 3 } } })}\n`
  const files = (cells, withLog = true) => ({
    'scripts/lanekit/baselines/guidance.json': baseline(cells),
    ...(withLog ? { 'scripts/lanekit/baselines/relock-log.jsonl': log } : {}),
  })
  assert.equal(check(k5, makeProject({}, files({ 'AGENTS.md': 3 }))).status, 'ok')
  const raised = check(k5, makeProject({}, files({ 'AGENTS.md': 30 })))
  assert.equal(raised.status, 'warn')
  assert.match(raised.message, /게이트를 거치지 않고 고친 것으로 보인다: guidance/)
  assert.equal(check(k5, makeProject({}, files({ 'AGENTS.md': 3 }, false))).status, 'warn', '이력 없이 놓인 기준선')
  assert.deepEqual(k5.findEditedBaselines({ a: { r: { f: 1 } } }, [{ check: 'a', values: { r: { f: 2 } } }, { check: 'a', values: { r: { f: 1 } } }]), [], '마지막 줄과 견준다')
  assert.deepEqual(k5.findEditedBaselines({ a: { r: { f: 1 } } }, [{ check: 'a', after: { r: 1 } }]), ['a'], '파일별 값이 없는 줄과는 견줄 수 없다')
  const lockedValues = { r: { 'src/a.ts': 1500 } }
  const entry = { check: 'a', after: { r: 1500 }, values: lockedValues }
  assert.deepEqual(k5.findEditedBaselines({ a: lockedValues }, [entry]), [])
  assert.deepEqual(k5.findEditedBaselines({ a: { r: { 'src/a.ts': 600, 'src/new.ts': 900 } } }, [entry]), ['a'], '합계를 맞춰 고쳐도 파일별 값이 다르면 알린다')
})

test('K6: ts 모듈을 켰을 때 typescript 가 없거나 5 · 6 이 아니면 warn 이다', () => {
  const fakeCompiler = (version, body = 'exports.createSourceFile = () => {}; exports.forEachChild = () => {}') => ({
    'node_modules/typescript/package.json': { name: 'typescript', version, main: 'index.js' },
    'node_modules/typescript/index.js': `exports.version = ${JSON.stringify(version)}; ${body}\n`,
  })
  assert.equal(check(k6, makeProject({})).status, 'skip', 'ts 모듈을 켜지 않았다')
  const absent = check(k6, makeProject({ modules: ['ts'] }))
  assert.equal(absent.status, 'warn')
  assert.match(absent.fix, /typescript 5 · 6/)
  assert.equal(check(k6, makeProject({ modules: ['ts'] }, fakeCompiler('6.0.3'))).status, 'ok')
  assert.equal(check(k6, makeProject({ modules: ['ts'] }, fakeCompiler('5.9.2'))).status, 'ok')
  const tooNew = check(k6, makeProject({ modules: ['ts'] }, fakeCompiler('7.0.2', '')))
  assert.equal(tooNew.status, 'warn')
  assert.match(tooNew.message, /typescript 7\.0\.2 은 쓸 수 없다/)
  assert.equal(k6.isSupportedCompiler({ version: '4.9.5', createSourceFile() {}, forEachChild() {} }), false)
})

test('I1 ~ I3: 가상 프로젝트의 지침 파일에서 크기 · 머신 경로 · 겹치는 절을 찾는다', () => {
  const dir = copyFixture()
  const size = check(i1, dir)
  assert.equal(size.status, 'warn')
  assert.match(size.message, /CLAUDE\.md \d+ > \d+/)
  const paths = check(i2, dir)
  assert.equal(paths.status, 'warn')
  assert.match(paths.message, /AGENTS\.md:\d+/)
  const headings = check(i3, dir)
  assert.equal(headings.status, 'warn')
  assert.match(headings.message, /AGENTS\.md:\d+/)
})

test('I1 ~ I3: init 이 놓은 지침 파일은 세 항목 모두 ok 다', async () => {
  const dir = await makeInstalledRepo()
  for (const checkModule of [i1, i2, i3]) assert.equal(check(checkModule, dir).status, 'ok', checkModule.meta.id)
})

test('I1: 예산은 설정의 값을 따른다', () => {
  const guidance = { 'CLAUDE.md': '# acme\n\n한 줄\n', 'AGENTS.md': '# 지침\n' }
  assert.equal(check(i1, makeProject({}, guidance)).status, 'ok')
  assert.equal(check(i1, makeProject({ checks: { guidance: { maxLines: { 'CLAUDE.md': 2 } } } }, guidance)).status, 'warn')
  assert.equal(check(i1, makeProject({})).status, 'ok', '지침 파일이 없으면 넘은 것도 없다')
})

test('doctor: 실패가 있으면 종료 코드 1 이고, 항목마다 상태와 고치는 법을 낸다', async () => {
  const empty = await runCommandModule(doctor, { cwd: makeTempDir(), machine })
  assert.equal(empty.code, 1)
  assert.match(empty.output, /✗ K1 /)
  assert.match(empty.output, /고치는 법: `lanekit init` 을 실행한다/)
  assert.match(empty.output, /결과: 정상 \d+ · 경고 \d+ · 실패 \d+ · 건너뜀 \d+/)
  assert.equal(empty.output.split('\n').filter((line) => /^[✓!✗-] [A-Z]\d /.test(line)).length, 25)
})

test('doctor: --json 은 같은 결과를 JSON 으로 낸다', async () => {
  const dir = await makeInstalledRepo()
  const { output } = await runCommandModule(doctor, { cwd: dir, argv: ['--json'], machine })
  const parsed = JSON.parse(output)
  assert.equal(parsed.results.length, 25)
  for (const result of parsed.results) {
    assert.ok(STATUSES.includes(result.status), `${result.id} ${result.status}`)
    assert.equal(typeof result.message, 'string')
    assert.equal(typeof result.fix, 'string')
  }
  assert.equal(parsed.results.find((result) => result.id === 'K2').status, 'ok')
})

test('doctor: 하위 폴더에서 실행해도 설정이 있는 루트를 점검하고, 아무것도 고치지 않는다', async () => {
  const dir = await makeInstalledRepo()
  writeFiles(dir, { 'src/deep/keep.txt': 'x\n' })
  const treeBefore = snapshotTree(dir, ['.git/'])
  const before = await runCommandModule(doctor, { cwd: dir, argv: ['--json'], machine })
  const nested = await runCommandModule(doctor, { cwd: join(dir, 'src/deep'), argv: ['--json'], machine })
  assert.equal(JSON.parse(nested.output).root, dir)
  assert.deepEqual(JSON.parse(nested.output).results, JSON.parse(before.output).results)
  assert.deepEqual(snapshotTree(dir, ['.git/']), treeBefore)
})

test('doctor: 항목이 오류로 끝나면 그 항목만 실패로 적고 나머지는 이어서 돈다', async () => {
  const translate = createCliTranslator('ko')
  const crashing = { meta: { id: 'X1', title: 'doctor.K1.title' }, check: () => { throw new Error('boom') } }
  const passing = { meta: { id: 'X2', title: 'doctor.K2.title' }, check: () => ({ status: 'ok', message: 'fine', fix: '' }) }
  const results = await doctor.runChecks({ t: translate }, [crashing, passing])
  assert.deepEqual(results.map((result) => result.status), ['fail', 'ok'])
  assert.match(results[0].message, /boom/)
  assert.deepEqual(doctor.countByStatus(results), { ok: 1, warn: 0, fail: 1, skip: 0 })
})

test('doctor: 모르는 플래그는 종료 코드 2 다', async () => {
  assert.equal((await runCommandModule(doctor, { cwd: makeTempDir(), argv: ['--fix'], machine })).code, 2)
})
