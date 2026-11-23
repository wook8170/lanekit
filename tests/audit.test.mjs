// 의존성 감사 검사 테스트 — 패키지 관리자 감지, 결과 형식 세 가지, 기준 심각도, 허용 항목의 만료를 본다.
// 대상: kit/checks/security/audit.mjs · audit-rules.mjs.
// 먼저 읽을 파일: ../kit/checks/security/audit-rules.mjs(판정).
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { judgeAdvisories, parseAuditOutput } from '../kit/checks/security/audit-rules.mjs'
import { detectManager, isAuditReadable, meta, run } from '../kit/checks/security/audit.mjs'
import { callCheck, fakeTool, withBarePath } from './check-helpers.mjs'
import { commitAll, gate, makeProject, readJson } from './helpers.mjs'

const HIGH = 'GHSA-aaaa-bbbb-cccc'
const MODERATE = 'GHSA-dddd-eeee-ffff'
const PNPM_REPORT = {
  advisories: {
    1001: { module_name: 'left-pad', severity: 'high', github_advisory_id: HIGH, url: `https://example.com/advisories/${HIGH}` },
    1002: { module_name: 'tiny-lib', severity: 'moderate', github_advisory_id: MODERATE },
  },
}
const NPM_REPORT = {
  vulnerabilities: {
    'left-pad': { severity: 'high', via: [{ source: 1001, name: 'left-pad', severity: 'high', url: `https://example.com/advisories/${HIGH}` }] },
    wrapper: { severity: 'high', via: ['left-pad'] },
  },
}
const YARN_LINES = [
  JSON.stringify({ value: 'left-pad', children: { ID: 1001, URL: `https://example.com/advisories/${HIGH}`, Severity: 'high' } }),
  JSON.stringify({ value: 'tiny-lib', children: { ID: 1002, Severity: 'low' } }),
].join('\n')

// 가짜 패키지 관리자: 정해 둔 글을 표준 출력에 내고 1 로 끝난다(감사 명령은 찾은 것이 있으면 0 이 아니다).
const fakeManager = (name, output) => fakeTool(name, `process.stdout.write(${JSON.stringify(output)}); process.exit(1)`)
const pnpmProject = (audit = {}) => makeProject({ checks: { audit } }, { 'pnpm-lock.yaml': 'lockfileVersion: 9\n' })
const runWith = (toolDir, dir) => withBarePath([toolDir], () => callCheck(run, 'security', dir, { profile: 'full', mode: 'fail' }))

test('full 프로필에서만 돈다', () => {
  assert.deepEqual(meta.profiles, ['full'])
})

test('잠금 파일로 패키지 관리자를 가린다. 없으면 건너뛴다', async () => {
  assert.equal(detectManager(pnpmProject()).name, 'pnpm')
  assert.equal(detectManager(makeProject({}, { 'package-lock.json': '{}' })).name, 'npm')
  assert.equal(detectManager(makeProject({}, { 'yarn.lock': '' })).name, 'yarn')
  const result = await callCheck(run, 'security', makeProject({}, {}), { profile: 'full' })
  assert.equal(result.status, 'skip')
  assert.equal(result.summary, '잠금 파일이 없어 감사를 돌리지 않았다')
})

test('결과 형식 세 가지를 같은 모양으로 읽는다', () => {
  const expected = { id: HIGH, package: 'left-pad', severity: 'high' }
  assert.deepEqual(parseAuditOutput('pnpm', JSON.stringify(PNPM_REPORT))[0], expected)
  assert.deepEqual(parseAuditOutput('npm', JSON.stringify(NPM_REPORT)), [expected])
  assert.deepEqual(parseAuditOutput('yarn', YARN_LINES), [expected, { id: '1002', package: 'tiny-lib', severity: 'low' }])
  assert.equal(parseAuditOutput('pnpm', 'ENOTFOUND registry'), null)
  assert.equal(parseAuditOutput('npm', '{"error":{"code":"ENOTFOUND"}}'), null)
})

test('기준 심각도 이상만 찾은 것으로 낸다', async () => {
  const toolDir = fakeManager('pnpm', JSON.stringify(PNPM_REPORT))
  const high = await runWith(toolDir, pnpmProject())
  assert.deepEqual(high.findings.map((found) => [found.rule, found.message]), [['high', `left-pad · ${HIGH} · 심각도 high`]])
  assert.deepEqual(high.metrics, { blocking: 1, accepted: 0, below: 1 })
  const moderate = await runWith(toolDir, pnpmProject({ failOn: 'moderate' }))
  assert.equal(moderate.findings.length, 2)
  assert.equal((await runWith(toolDir, pnpmProject({ failOn: 'critical' }))).status, 'pass')
})

test('허용 항목은 만료일까지만 통한다. 만료된 허용 항목은 다시 실패한다', async () => {
  const toolDir = fakeManager('pnpm', JSON.stringify(PNPM_REPORT))
  const allowUntil = (expires) => pnpmProject({ allow: [{ id: HIGH, reason: '운영 경로에서 쓰지 않는다', expires }] })
  const active = await runWith(toolDir, allowUntil('2999-12-31'))
  assert.equal(active.status, 'pass')
  assert.equal(active.metrics.accepted, 1)
  const expired = await runWith(toolDir, allowUntil('2000-01-01'))
  assert.deepEqual(expired.findings.map((found) => found.rule), ['allow-expired'])
  assert.match(expired.findings[0].message, /허용이 2000-01-01 에 끝났다/)
  const { code } = await withBarePath([toolDir], () => gate(allowUntil('2000-01-01'), ['--profile', 'full', '--only', 'audit', '--no-evidence']))
  assert.equal(code, 1)
})

test('판정 함수: 만료일 당일까지는 허용이고, 날짜 꼴이 틀리면 허용하지 않는다', () => {
  const advisories = [{ id: HIGH, package: 'left-pad', severity: 'high' }]
  const judge = (expires, today) => judgeAdvisories({ advisories, allow: [{ id: HIGH, reason: 'r', expires }], failOn: 'high', today })
  assert.equal(judge('2026-03-01', '2026-03-01').accepted.length, 1)
  assert.equal(judge('2026-03-01', '2026-03-02').blocking[0].allowance, 'expired')
  assert.equal(judge('next month', '2026-03-01').blocking[0].allowance, 'invalid')
  assert.equal(judgeAdvisories({ advisories, allow: [], failOn: 'high', today: '2026-03-01' }).blocking[0].allowance, 'none')
})

test('감사 결과를 얻지 못하면 full 프로필에서도 실패가 아니라 경고로 건너뛴다. 사유는 증거 파일에 남는다', async () => {
  const unreachable = await runWith(fakeManager('pnpm', 'ENOTFOUND registry'), pnpmProject())
  assert.deepEqual([unreachable.status, unreachable.unverified], ['skip', true])
  assert.match(unreachable.summary, /감사 결과를 읽을 수 없다/)
  const missing = await withBarePath([], () => callCheck(run, 'security', pnpmProject(), { profile: 'full' }))
  assert.deepEqual([missing.status, missing.unverified], ['skip', true])
  assert.match(missing.summary, /pnpm 실행 파일을 찾지 못해/)
  const dir = pnpmProject()
  const commit = commitAll(dir)
  const { code, output } = await withBarePath([fakeManager('pnpm', 'ENOTFOUND registry')], () => gate(dir, ['--profile', 'full', '--only', 'audit']))
  assert.equal(code, 0, output)
  assert.match(output, /! audit\s+fail\s+건너뜀.*감사 결과를 읽을 수 없다.*확인하지 못해 건너뛰었다\(경고\)/)
  assert.match(output, /경고: 도구가 없거나 결과를 얻지 못해 확인하지 못한 검사가 있다: audit/)
  const [record] = readJson(join(dir, '.lanekit/evidence', `${commit.slice(0, 12)}-full-partial.json`)).checks
  assert.deepEqual([record.id, record.status, record.verdict, record.reason], ['audit', 'skip', 'skip', 'check-unverified'])
  assert.match(record.summary, /감사 결과를 읽을 수 없다/)
})

test('잠금 파일이 없으면 감사할 것이 없으므로 경고 없이 건너뛴다', async () => {
  const noLock = await withBarePath([], () => callCheck(run, 'security', makeProject({}, {}), { profile: 'full' }))
  assert.deepEqual([noLock.status, Boolean(noLock.unverified)], ['skip', false])
  const light = await withBarePath([fakeManager('pnpm', 'ENOTFOUND registry')], () => callCheck(run, 'security', pnpmProject(), { profile: 'light' }))
  assert.deepEqual([light.status, light.unverified], ['skip', true])
})

test('권고가 0건인데 감사 명령이 실패 코드로 끝나면 결과로 믿지 않는다(yarn 이 죽은 경우)', async () => {
  const dir = makeProject({}, { 'yarn.lock': '# yarn\n' })
  const dead = await withBarePath([fakeTool('yarn', 'process.exit(1)')], () => callCheck(run, 'security', dir, { profile: 'full' }))
  assert.deepEqual([dead.status, dead.unverified], ['skip', true])
  const clean = await withBarePath([fakeTool('yarn', 'process.exit(0)')], () => callCheck(run, 'security', dir, { profile: 'full' }))
  assert.equal(clean.status, 'pass')
  const ended = (code) => ({ code, failedToStart: code === null })
  assert.deepEqual([isAuditReadable([], ended(1)), isAuditReadable([], ended(null)), isAuditReadable([], ended(0)), isAuditReadable([{}], ended(1)), isAuditReadable(null, ended(0))], [false, false, true, true, false])
  assert.equal(isAuditReadable([{}], ended(null)), false, '시간 초과나 신호로 죽었으면 그때까지 나온 권고도 믿지 않는다')
})

test('npm 잠금 파일이면 npm 감사를 돌린다', async () => {
  const dir = makeProject({}, { 'package-lock.json': '{}' })
  const result = await runWith(fakeManager('npm', JSON.stringify(NPM_REPORT)), dir)
  assert.deepEqual(result.findings.map((found) => [found.file, found.rule]), [['npm', 'high']])
})
