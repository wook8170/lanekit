// 테스트 검사(tests) 테스트 — 프로필로 명령을 고르는지, {files} 를 채우는지, 종료 코드로 판정하는지를 본다.
// 대상: kit/checks/tests/run.mjs.
// 먼저 읽을 파일: ../kit/checks/tests/run.mjs 의 planCommand(판정).
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { meta, planCommand, run } from '../kit/checks/tests/run.mjs'
import { callCheck } from './check-helpers.mjs'
import { commitAll, gate, git, makeProject, readJson, writeFiles } from './helpers.mjs'

const options = { full: 'run-all', changed: 'run-some {files}' }
// sh 와 cmd.exe 가 같게 읽는 명령만 쓴다. 두 셸 모두 큰따옴표 안의 작은따옴표를 글자 그대로 넘긴다.
const PRINT_GREEN = `node -e "console.log('all-green')"`
const FAIL_WITH_3 = `node -e "console.error('boom'); process.exit(3)"`
const SAVE_FILES = `node -e "require('node:fs').writeFileSync('seen.txt', process.argv.slice(1).join(' ') + String.fromCharCode(10))" {files}`

test('changed 와 full 프로필에서만 돈다', () => {
  assert.deepEqual(meta.profiles, ['changed', 'full'])
})

test('명령 고르기', () => {
  assert.deepEqual(planCommand({ profile: 'full', options, existingChangedFiles: null }), { command: 'run-all' })
  assert.deepEqual(planCommand({ profile: 'changed', options, existingChangedFiles: ['a.mjs', "it's.mjs"], platform: 'linux' }), { command: "run-some 'a.mjs' 'it'\\''s.mjs'" })
  assert.deepEqual(planCommand({ profile: 'changed', options, existingChangedFiles: [] }), { skip: 'no-changed-files' })
  assert.deepEqual(planCommand({ profile: 'changed', options, existingChangedFiles: null }), { command: 'run-all' }, '바뀐 파일을 모르면 전체 명령')
  assert.deepEqual(planCommand({ profile: 'changed', options: { full: 'x', changed: 'fixed' }, existingChangedFiles: [] }), { command: 'fixed' })
  assert.deepEqual(planCommand({ profile: 'full', options: { full: '', changed: 'x' }, existingChangedFiles: null }), { skip: 'no-command' })
  assert.deepEqual(planCommand({ profile: 'changed', options: { full: 'x', changed: '' }, existingChangedFiles: ['a'] }), { skip: 'no-command' })
})

test('명령이 0 으로 끝나면 통과하고 출력을 남긴다', async () => {
  const dir = makeProject({ checks: { tests: { full: PRINT_GREEN } } }, {})
  const result = await callCheck(run, 'tests', dir, { profile: 'full', mode: 'fail' })
  assert.equal(result.status, 'pass')
  assert.equal(readFileSync(join(dir, '.lanekit', 'reports', 'tests-full.log'), 'utf8'), 'all-green\n')
})

test('명령이 0 이 아닌 코드로 끝나면 찾은 것으로 내고 게이트는 1 로 끝난다', async () => {
  const dir = makeProject({ checks: { tests: { full: FAIL_WITH_3 } } }, {})
  const result = await callCheck(run, 'tests', dir, { profile: 'full', mode: 'fail' })
  assert.deepEqual(result.findings.map((found) => [found.rule, found.message]), [['tests-failed', '테스트 명령이 3 로 끝났다 · 출력: .lanekit/reports/tests-full.log']])
  assert.equal(result.metrics.exitCode, 3)
  const { code } = await gate(dir, ['--profile', 'full', '--only', 'tests', '--no-evidence'])
  assert.equal(code, 1)
})

test('changed 프로필은 바뀐 파일을 {files} 에 넣고, 지워진 파일은 넣지 않는다', async () => {
  const dir = makeProject({ checks: { tests: { full: 'exit 9', changed: SAVE_FILES } } }, { 'a.mjs': '1\n', 'gone.mjs': '1\n' })
  commitAll(dir)
  git(dir, 'checkout', '-q', '-b', 'topic')
  writeFiles(dir, { 'a.mjs': '2\n', 'new file.mjs': '1\n' })
  git(dir, 'rm', '-q', 'gone.mjs')
  const { code, output } = await gate(dir, ['--profile', 'changed', '--only', 'tests', '--no-evidence'])
  assert.equal(code, 0, output)
  assert.equal(readFileSync(join(dir, 'seen.txt'), 'utf8'), 'a.mjs new file.mjs\n')
})

test('명령이 비어 있으면 건너뛰고, 증거 파일에 「테스트 명령 없음」으로 남는다', async () => {
  const dir = makeProject({}, { 'a.txt': 'a\n' })
  const commit = commitAll(dir)
  const { code } = await gate(dir, ['--profile', 'full', '--only', 'tests'])
  assert.equal(code, 0)
  const evidence = readJson(join(dir, '.lanekit', 'evidence', `${commit.slice(0, 12)}-full-partial.json`))
  const record = evidence.checks.find((check) => check.id === 'tests')
  assert.equal(record.status, 'skip')
  assert.match(record.summary, /^테스트 명령 없음/)
  assert.equal(existsSync(join(dir, '.lanekit', 'reports')), false)
})

test('light 프로필에서는 돌지 않는다', async () => {
  const dir = makeProject({ checks: { tests: { full: 'exit 1' } } }, {})
  const { code, output } = await gate(dir, ['--only', 'tests', '--no-evidence'])
  assert.equal(code, 0)
  assert.match(output, /- tests .*이 프로필에서는 돌지 않는다/)
})
