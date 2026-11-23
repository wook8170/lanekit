// 문서 드리프트 검사 테스트 — 원천 다섯 가지, 「한 번도 맞지 않음」, 화살표 이력 건너뛰기를 본다.
// 대상: kit/checks/docs-drift/ · kit/lib/glob.mjs · kit/lib/files.mjs.
// 먼저 읽을 파일: ../kit/checks/docs-drift/claims.mjs(판정).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findClaims, isHistoryNote, judgeFact } from '../kit/checks/docs-drift/claims.mjs'
import { run } from '../kit/checks/docs-drift/run.mjs'
import { readJsonPath } from '../kit/checks/docs-drift/sources.mjs'
import { globToRegExp, matchesAny } from '../kit/lib/glob.mjs'
import { callCheck, rulesOf } from './check-helpers.mjs'
import { gate, makeProject } from './helpers.mjs'

const fact = (id, pattern, source, doc = 'docs/api.md') => ({ id, doc, pattern, source })

const FILES = {
  'docs/api.md': ['도구 2개를 낸다.', '라우트 3개가 있다.', '역할은 4가지다.', '버전 1.2.0 이다.', '명령의 답은 7 이다.'].join('\n'),
  'src/tools/alpha.ts': "route('/a')\nroute('/b')\n",
  'src/tools/beta.ts': "route('/c')\n",
  'data/roles.json': JSON.stringify({ roles: { list: ['a', 'b', 'c', 'd'] }, version: '1.2.0' }),
}

const FACTS = [
  fact('tool-count', '도구 (\\d+)개', { kind: 'count-files', glob: 'src/tools/*.ts' }),
  fact('route-count', '라우트 (\\d+)개', { kind: 'count-matches', glob: 'src/**/*.ts', pattern: "route\\('" }),
  fact('role-count', '역할은 (\\d+)가지', { kind: 'json-length', file: 'data/roles.json', path: 'roles.list' }),
  fact('version', '버전 ([\\d.]+\\d)', { kind: 'json-value', file: 'data/roles.json', path: 'version' }),
  fact('answer', '답은 (\\d+)', { kind: 'command', command: 'echo 7' }),
]

const project = (facts, files = FILES) => makeProject({ checks: { 'docs-drift': { facts } } }, files)

test('원천 다섯 가지가 문서와 맞으면 통과한다', async () => {
  const result = await callCheck(run, 'docs-drift', project(FACTS), { profile: 'full' })
  assert.equal(result.status, 'pass', JSON.stringify(result.findings))
  assert.deepEqual(result.metrics, { facts: 5, findings: 0, deferredCommands: 0 })
})

test('원천마다 값이 다르면 문서의 줄과 두 값을 알린다', async () => {
  const drifted = { ...FILES, 'docs/api.md': ['도구 5개를 낸다.', '라우트 9개가 있다.', '역할은 1가지다.', '버전 1.1.0 이다.', '명령의 답은 8 이다.'].join('\n') }
  const result = await callCheck(run, 'docs-drift', project(FACTS, drifted), { profile: 'full' })
  assert.deepEqual(result.findings.map((found) => [found.rule, found.line, found.value, found.limit]), [
    ['mismatch', 1, '5', '2'],
    ['mismatch', 2, '9', '3'],
    ['mismatch', 3, '1', '4'],
    ['mismatch', 4, '1.1.0', '1.2.0'],
    ['mismatch', 5, '8', '7'],
  ])
  assert.equal(result.findings[0].message, '[tool-count] 문서의 값 5 이 코드에서 센 값 2 과 다르다')
})

test('명령 원천은 full 프로필에서만 돌리고 그 밖에는 미룬다', async () => {
  const drifted = { ...FILES, 'docs/api.md': FILES['docs/api.md'].replace('답은 7', '답은 8') }
  const result = await callCheck(run, 'docs-drift', project(FACTS, drifted), { profile: 'light' })
  assert.equal(result.status, 'pass')
  assert.equal(result.metrics.deferredCommands, 1)
})

test('pattern 이 한 번도 맞지 않으면 찾은 것으로 낸다', async () => {
  const facts = [fact('tool-count', '도구 수는 (\\d+)', { kind: 'count-files', glob: 'src/tools/*.ts' })]
  const result = await callCheck(run, 'docs-drift', project(facts))
  assert.deepEqual(rulesOf(result), ['pattern-not-found'])
  assert.match(result.findings[0].message, /한 번도 맞지 않았다/)
})

test('화살표 앞뒤의 값은 이력이라 건너뛴다', async () => {
  const files = { ...FILES, 'docs/api.md': '도구 2개를 낸다.\n이전 버전에서 도구 1개 → 도구 2개로 늘었다.\n기록: 7->도구 9개\n' }
  const result = await callCheck(run, 'docs-drift', project([FACTS[0]], files))
  assert.equal(result.status, 'pass', JSON.stringify(result.findings))
  assert.equal(isHistoryNote('도구 73→112개', 3, 2), true, '화살표 앞의 값')
  assert.equal(isHistoryNote('도구 73→112개', 6, 3), true, '화살표 뒤의 값')
  assert.equal(isHistoryNote('- **도구 112개**', 7, 3), false, '글머리표는 화살표가 아니다')
})

test('읽을 수 없는 문서 · 원천 · 틀린 정규식은 찾은 것이 된다', async () => {
  const facts = [
    fact('no-doc', '(\\d+)', { kind: 'count-files', glob: 'src/**' }, 'docs/none.md'),
    fact('no-glob', '(\\d+)', { kind: 'count-files' }),
    fact('no-file', '(\\d+)', { kind: 'json-length', file: 'data/none.json', path: 'a' }),
    fact('no-path', '(\\d+)', { kind: 'json-value', file: 'data/roles.json', path: 'roles.none' }),
    fact('not-countable', '(\\d+)', { kind: 'json-length', file: 'data/roles.json', path: 'version' }),
    fact('bad-pattern', '(\\d+', { kind: 'count-files', glob: 'src/**' }),
    fact('bad-command', '(\\d+)', { kind: 'command', command: 'exit 3' }),
  ]
  const result = await callCheck(run, 'docs-drift', project(facts), { profile: 'full' })
  assert.deepEqual(rulesOf(result), [
    'doc-missing', 'source-field-missing', 'source-file-missing', 'source-path-missing', 'source-not-countable', 'pattern-invalid', 'source-command-failed',
  ])
})

test('facts 가 비어 있으면 건너뛴다', async () => {
  const result = await callCheck(run, 'docs-drift', project([]))
  assert.equal(result.status, 'skip')
})

test('판정 함수: 묶음이 없으면 맞은 글자 전체가 값이고 자릿수 쉼표는 빼고 견준다', () => {
  assert.deepEqual(findClaims('v1.2.0', 'v[\\d.]+').map((claim) => claim.stated), ['v1.2.0'])
  assert.deepEqual(judgeFact(findClaims('행 1,234개', '행 ([\\d,]+)개'), '1234'), [])
  assert.deepEqual(judgeFact([], '1'), [{ rule: 'pattern-not-found', line: null }])
  assert.equal(readJsonPath({ a: { b: [1, 2] } }, 'a.b').length, 2)
  assert.equal(readJsonPath({ a: 1 }, 'a.b.c'), undefined)
})

test('글롭: ** 는 폴더를 넘고 * 는 넘지 않는다. 쉼표는 중괄호 안에서만 「또는」이다', () => {
  assert.equal(globToRegExp('docs/**/*.md').test('docs/a.md'), true)
  assert.equal(globToRegExp('docs/**/*.md').test('docs/x/y/a.md'), true)
  assert.equal(globToRegExp('src/*.ts').test('src/x/a.ts'), false)
  assert.equal(globToRegExp('README*.md').test('README.ko.md'), true)
  assert.equal(globToRegExp('**/*.{ts,tsx}').test('a/b.tsx'), true)
  assert.equal(globToRegExp('a,b.md').test('a,b.md'), true)
  assert.equal(globToRegExp('a+b|c.md').test('a+b|c.md'), true)
  assert.equal(matchesAny('lib/a.js', ['src/**', 'lib/?.js']), true)
})

test('게이트: fail 모드에서 값이 다르면 1 로 끝난다', async () => {
  const drifted = { ...FILES, 'docs/api.md': '도구 5개를 낸다.' }
  const dir = makeProject({ checks: { 'docs-drift': { mode: 'fail', facts: [FACTS[0]] } } }, drifted)
  const { code, output } = await gate(dir, ['--only', 'docs-drift', '--no-evidence'])
  assert.equal(code, 1)
  assert.match(output, /docs\/api\.md:1 \[mismatch\]/)
})
