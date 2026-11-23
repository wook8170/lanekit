// 비밀값 검사 테스트 — 내장 규칙 여섯 가지, 허용 목록, 이력, gitleaks 를 쓰는 길을 본다.
// 대상: kit/checks/security/secrets.mjs · secret-rules.mjs · gitleaks.mjs · kit/lib/history.mjs.
// 먼저 읽을 파일: ../kit/checks/security/secret-rules.mjs(내장 규칙).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isLockHash, parseGitleaksReport } from '../kit/checks/security/gitleaks.mjs'
import { SECRET_RULE_NAMES, matchSecretRules } from '../kit/checks/security/secret-rules.mjs'
import { chooseTool, dropAllowed, run } from '../kit/checks/security/secrets.mjs'
import { parseAddedLines } from '../kit/lib/history.mjs'
import { callCheck, fakeTool, rulesOf, withBarePath } from './check-helpers.mjs'
import { commitAll, gate, git, makeProject, writeFiles } from './helpers.mjs'

// 비밀값의 모양은 조각을 이어 만든다. 이 파일 자체가 비밀값 검사에 걸리지 않게 하기 위해서다.
const glue = (...parts) => parts.join('')
const SAMPLES = {
  'cloud-access-key': glue('AK', 'IA', 'ABCDEFGHIJKLMNOP'),
  'private-key': glue('-----BEGIN RSA ', 'PRIVATE KEY-----'),
  jwt: glue('ey', 'JhbGciOiJIUzI1NiJ9', '.', 'ey', 'JzdWIiOiJhY21lIn0', '.', 'c2lnbmF0dXJlLXBhcnQ'),
  'git-host-token': glue('gh', 'p_', 'a'.repeat(36)),
  'chat-token': glue('xo', 'xb-', '1234567890-abcdefghij'),
  'password-assignment': glue('pass', 'word = "', 'correct-horse-9', '"'),
}

const builtinProject = (files, secrets = {}) => makeProject({ checks: { secrets: { tool: 'builtin', ...secrets } } }, files)

test('내장 규칙 여섯 가지를 모두 잡는다', () => {
  assert.deepEqual(Object.keys(SAMPLES), SECRET_RULE_NAMES)
  for (const [rule, sample] of Object.entries(SAMPLES)) {
    assert.deepEqual(matchSecretRules(`const value = ${sample}`), [rule], rule)
  }
})

test('값이 아닌 것은 잡지 않는다: 변수 참조 · 자리표시 · 짧은 값 · 설명 글', () => {
  const harmless = [
    glue('pass', 'word = "${DB_PASSWORD}"'),
    glue('pass', 'word: "<your-password>"'),
    glue('pass', 'word = "short"'),
    'The password must be at least 12 characters.',
    'AKIA is the prefix of an access key.',
  ]
  for (const lineText of harmless) assert.deepEqual(matchSecretRules(lineText), [], lineText)
})

test('run: 추적 중인 파일에서 찾고, 값은 출력하지 않는다', async () => {
  const dir = builtinProject({ 'src/config.mjs': `export const key = '${SAMPLES['cloud-access-key']}'\n`, 'notes.txt': 'clean\n' })
  commitAll(dir)
  writeFiles(dir, { 'untracked.env': `${SAMPLES['git-host-token']}\n` })
  const result = await callCheck(run, 'security', dir, { mode: 'fail' })
  assert.deepEqual(result.findings.map((found) => [found.file, found.line, found.rule]), [['src/config.mjs', 1, 'cloud-access-key']])
  assert.ok(!JSON.stringify(result).includes(SAMPLES['cloud-access-key']))
  assert.equal(result.metrics.usedGitleaks, 0)
})

test('run: 바이너리 파일은 건너뛴다', async () => {
  const dir = builtinProject({ 'blob.bin': `\u0000${SAMPLES.jwt}` })
  assert.equal((await callCheck(run, 'security', dir)).status, 'pass')
})

test('허용 목록: 파일 글롭이 맞고 rule 이 비었거나 같으면 뺀다', async () => {
  const found = [{ file: 'tests/a.mjs', rule: 'jwt' }, { file: 'tests/a.mjs', rule: 'private-key' }, { file: 'src/a.mjs', rule: 'jwt' }]
  assert.deepEqual(dropAllowed(found, [{ file: 'tests/**', rule: 'jwt', reason: '가짜 값' }]), [found[1], found[2]])
  assert.deepEqual(dropAllowed(found, [{ file: 'tests/**', rule: '', reason: '가짜 값' }]), [found[2]])
  const dir = builtinProject({ 'tests/a.mjs': `${SAMPLES.jwt}\n` }, { allow: [{ file: 'tests/**', reason: '테스트 자료' }] })
  const result = await callCheck(run, 'security', dir)
  assert.equal(result.status, 'pass')
  assert.equal(result.metrics.allowed, 1)
})

test('full 프로필은 지금은 지운 비밀값도 이력에서 찾는다', async () => {
  const dir = builtinProject({ 'src/config.mjs': `${SAMPLES['chat-token']}\n` })
  const leaked = commitAll(dir)
  writeFiles(dir, { 'src/config.mjs': 'clean\n' })
  git(dir, 'commit', '-q', '-am', 'remove')
  assert.equal((await callCheck(run, 'security', dir, { profile: 'light' })).status, 'pass')
  const full = await callCheck(run, 'security', dir, { profile: 'full' })
  assert.deepEqual(full.findings.map((found) => [found.file, found.line, found.rule]), [[`src/config.mjs@${leaked.slice(0, 8)}`, null, 'chat-token']])
})

test('이력 읽기: 더해진 줄만 커밋 · 파일과 함께 뽑는다', () => {
  const changed = ['lanekit-commit abc', 'diff --git a/a.txt b/a.txt', '--- a/a.txt', '+++ b/a.txt', '@@ -1 +1 @@', '-old', '+new']
  const deleted = ['diff --git a/b.txt b/b.txt', '--- a/b.txt', '+++ /dev/null', '@@ -1 +0,0 @@', '-gone']
  assert.deepEqual(parseAddedLines([...changed, ...deleted].join('\n')), [{ commit: 'abc', file: 'a.txt', text: 'new' }])
})

test('도구 고르기: auto 는 gitleaks 가 있으면 쓰고 없으면 내장 규칙을 쓴다', () => {
  assert.deepEqual(chooseTool('auto', true), { tool: 'gitleaks' })
  assert.deepEqual(chooseTool('auto', false), { tool: 'builtin' })
  assert.deepEqual(chooseTool('builtin', true), { tool: 'builtin' })
  assert.deepEqual(chooseTool('gitleaks', false), { tool: null, problem: 'gitleaks-missing' })
})

// 가짜 gitleaks: 받은 인자를 기록하고, --report-path 에 정해 둔 보고를 쓰고, 찾은 것이 있으면 1 로 끝난다.
const FAKE_GITLEAKS = `
const { appendFileSync, writeFileSync } = require('node:fs')
const args = process.argv.slice(2)
const source = args[args.indexOf('--source') + 1]
appendFileSync(source + '/gitleaks-calls.log', args.join(' ') + '\\n')
const leaks = args.includes('--no-git')
  ? [{ RuleID: 'generic-api-key', File: source + '/src/config.mjs', StartLine: 3, Commit: '' }, { RuleID: 'generic-api-key', File: source + '/ignored.env', StartLine: 1, Commit: '' }]
  : [{ RuleID: 'generic-api-key', File: 'old.txt', StartLine: 9, Commit: 'feedc0de12345678' }]
writeFileSync(args[args.indexOf('--report-path') + 1], JSON.stringify(leaks))
process.exit(1)
`

test('gitleaks 가 있으면 그것을 쓴다. 작업 트리에서 찾은 것은 추적 중인 파일로 좁힌다', async () => {
  const dir = makeProject({}, { 'src/config.mjs': 'clean\n', '.gitignore': '.lanekit/\nignored.env\ngitleaks-calls.log\n' })
  commitAll(dir)
  writeFiles(dir, { 'ignored.env': 'x\n' })
  const light = await withBarePath([fakeTool('gitleaks', FAKE_GITLEAKS)], () => callCheck(run, 'security', dir))
  assert.equal(light.metrics.usedGitleaks, 1)
  assert.deepEqual(light.findings.map((found) => [found.file, found.line, found.rule]), [['src/config.mjs', 3, 'generic-api-key']])
  const full = await withBarePath([fakeTool('gitleaks', FAKE_GITLEAKS)], () => callCheck(run, 'security', dir, { profile: 'full' }))
  assert.deepEqual(full.findings.map((found) => found.file), ['src/config.mjs', 'old.txt@feedc0de'])
  const { readFileSync } = await import('node:fs')
  const calls = readFileSync(`${dir}/gitleaks-calls.log`, 'utf8').trim().split('\n')
  assert.equal(calls.length, 3)
  assert.ok(calls.every((call) => call.startsWith('detect ') && call.includes('--redact')))
  assert.deepEqual(calls.map((call) => call.includes('--no-git')), [true, true, false])
})

test('gitleaks 가 없으면 내장 규칙으로 본다. tool 이 gitleaks 인데 없으면 오류다', async () => {
  const dir = makeProject({}, { 'a.txt': `${SAMPLES['private-key']}\n` })
  const auto = await withBarePath([], () => callCheck(run, 'security', dir))
  assert.deepEqual(rulesOf(auto), ['private-key'])
  const fixed = makeProject({ checks: { secrets: { tool: 'gitleaks' } } }, {})
  assert.equal((await withBarePath([], () => callCheck(run, 'security', fixed))).status, 'error')
})

test('gitleaks 보고 읽기: 절대 경로는 루트 기준으로 바꾸고, 커밋이 있으면 줄 번호를 비운다', () => {
  const report = JSON.stringify([{ RuleID: 'r', File: '/repo/a/b.txt', StartLine: 2, Commit: '' }, { RuleID: 'r', File: 'c.txt', StartLine: 5, Commit: 'abc' }])
  assert.deepEqual(parseGitleaksReport(report, '/repo'), [
    { file: 'a/b.txt', line: 2, rule: 'r', commit: null, sourceLine: 2 },
    { file: 'c.txt', line: null, rule: 'r', commit: 'abc', sourceLine: 5 },
  ])
  assert.deepEqual(parseGitleaksReport('', '/repo'), [])
})

const LOCK_PATH = 'scripts/lanekit/lanekit.lock.json'
const LOCK_TEXT = `{\n  "files": {\n    "checks/security/secret-rules.mjs": "${'ab12'.repeat(16)}",\n    "note": "not a hash"\n  }\n}\n`
// 가짜 gitleaks: 잠금 파일의 해시 줄(3)과 해시가 아닌 줄(4)을 모두 찾았다고 보고한다.
const LOCK_GITLEAKS = `
const { writeFileSync } = require('node:fs')
const args = process.argv.slice(2)
const leaks = [3, 4].map((StartLine) => ({ RuleID: 'generic-api-key', File: ${JSON.stringify(LOCK_PATH)}, StartLine, Commit: '' }))
writeFileSync(args[args.indexOf('--report-path') + 1], JSON.stringify(args.includes('--no-git') ? leaks : []))
process.exit(1)
`

test('gitleaks 가 잠금 파일의 sha256 을 비밀값으로 봐도 해시 줄은 빼고, 같은 파일의 다른 줄은 남긴다', async () => {
  const dir = makeProject({}, { [LOCK_PATH]: LOCK_TEXT })
  commitAll(dir)
  const result = await withBarePath([fakeTool('gitleaks', LOCK_GITLEAKS)], () => callCheck(run, 'security', dir))
  assert.deepEqual(result.findings.map((found) => [found.file, found.line]), [[LOCK_PATH, 4]])
  const leak = { file: LOCK_PATH, sourceLine: 3 }
  assert.equal(isLockHash(leak, LOCK_TEXT), true)
  assert.equal(isLockHash({ ...leak, file: 'src/config.json' }, LOCK_TEXT), false, '다른 파일의 해시는 빼지 않는다')
  assert.equal(isLockHash(leak, null), false, '글을 읽지 못하면 빼지 않는다')
  const outsideFiles = `{\n  "files": {},\n  "apiSecret": "${'ab12'.repeat(16)}"\n}\n`
  assert.equal(isLockHash(leak, outsideFiles), false, 'files 칸 밖의 줄은 해시처럼 보여도 빼지 않는다')
  assert.equal(isLockHash(leak, '{ broken'), false, '잠금 파일을 JSON 으로 읽지 못하면 빼지 않는다')
})

test('한글 이름의 파일도 읽어서 본다', async () => {
  const dir = builtinProject({ '설정 값.txt': `${SAMPLES['git-host-token']}\n` })
  commitAll(dir)
  const result = await withBarePath([], () => callCheck(run, 'security', dir))
  assert.deepEqual(result.findings.map((found) => [found.file, found.rule]), [['설정 값.txt', 'git-host-token']])
})

test('게이트: 기본 모드가 fail 이라 찾으면 1 로 끝나고, 출력에 값이 없다', async () => {
  const dir = builtinProject({ 'a.txt': `${SAMPLES['git-host-token']}\n` })
  const { code, output } = await gate(dir, ['--only', 'secrets', '--no-evidence'])
  assert.equal(code, 1)
  assert.match(output, /a\.txt:1 \[git-host-token\]/)
  assert.ok(!output.includes(SAMPLES['git-host-token']))
})
