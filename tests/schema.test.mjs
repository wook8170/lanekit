// 설정 스키마 테스트 — 기본값 채우기, 모르는 키와 틀린 값의 거절, 종료 코드 2 를 본다.
// 대상: kit/lib/schema.mjs · kit/lib/config.mjs.
// 먼저 읽을 파일: ../kit/lib/schema.mjs(받는 키).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { validateConfig } from '../kit/lib/config.mjs'
import { CHECK_IDS } from '../kit/lib/schema.mjs'
import { REGISTERED_IDS } from '../kit/lib/registry.mjs'
import { meta as guidanceMeta } from '../kit/checks/guidance/run.mjs'
import { gate, makeProject, makeTempDir, writeFiles } from './helpers.mjs'

const problemsOf = (raw) => validateConfig(raw).problems
const codesOf = (raw) => problemsOf(raw).map((problem) => `${problem.code} ${problem.path}`)

test('빈 설정은 기본값으로 채워진다', () => {
  const { config, problems } = validateConfig({})
  assert.deepEqual(problems, [])
  assert.equal(config.version, 1)
  assert.equal(config.lang, 'ko')
  assert.equal(config.repo.visibility, 'private')
  assert.deepEqual(config.modules, [])
  assert.equal(config.remote_gate, 'git-hook')
  const modes = Object.fromEntries(Object.entries(config.checks).map(([id, options]) => [id, options.mode]))
  assert.deepEqual(modes, {
    structure: 'warn', 'docs-drift': 'warn', writing: 'warn', secrets: 'fail', audit: 'fail', sbom: 'warn',
    provenance: 'warn', exposure: 'auto', wiki: 'warn', guidance: 'warn', tests: 'fail',
  })
  assert.deepEqual(config.checks.structure.limits, { fileLines: 500, fn: { warn: 60, fail: 100 }, component: { warn: 150, fail: 300 }, componentHooks: 20, complexity: 15, depth: 4 })
  assert.deepEqual(config.checks.structure.readable.bannedNames, ['tmp', 'temp', 'cfg', 'obj', 'val'])
  assert.deepEqual(config.checks.guidance.maxLines, { 'CLAUDE.md': 30 })
  assert.deepEqual(config.checks.guidance.maxBytes, { 'AGENTS.md': 40000 })
})

test('적은 키만 바뀌고 나머지는 기본값이다', () => {
  const { config } = validateConfig({ checks: { structure: { limits: { fileLines: 400 } }, guidance: { maxLines: { 'CLAUDE.md': 10 } } } })
  assert.equal(config.checks.structure.limits.fileLines, 400)
  assert.equal(config.checks.structure.limits.complexity, 15)
  assert.deepEqual(config.checks.guidance.maxLines, { 'CLAUDE.md': 10 })
})

test('기본값은 호출마다 새 객체다', () => {
  const first = validateConfig({}).config
  first.checks.writing.globs.push('changed')
  assert.deepEqual(validateConfig({}).config.checks.writing.globs, ['docs/**/*.md', 'README*.md'])
})

test('모르는 키는 어느 깊이에서든 문제로 잡힌다', () => {
  assert.deepEqual(codesOf({ chekcs: {} }), ['unknown-key chekcs'])
  assert.deepEqual(codesOf({ checks: { structure: { mod: 'off' } } }), ['unknown-key checks.structure.mod'])
  assert.deepEqual(codesOf({ checks: { structure: { limits: { fn: { warning: 1 } } } } }), ['unknown-key checks.structure.limits.fn.warning'])
  assert.deepEqual(codesOf({ checks: { lint: { mode: 'off' } } }), ['unknown-key checks.lint'])
  const [problem] = problemsOf({ repo: { visiblity: 'public' } })
  assert.equal(problem.expected, 'visibility', '받는 키를 함께 알린다')
})

test('받지 않는 값과 틀린 타입은 경로와 받는 값을 알린다', () => {
  assert.deepEqual(problemsOf({ checks: { structure: { mode: 'strict' } } }), [
    { path: 'checks.structure.mode', code: 'not-allowed', expected: 'off | warn | ratchet | fail', got: '"strict"' },
  ])
  assert.deepEqual(codesOf({ checks: { guidance: { mode: 'auto' } } }), ['not-allowed checks.guidance.mode'], 'auto 는 exposure 만 받는다')
  assert.deepEqual(codesOf({ checks: { exposure: { mode: 'auto' } } }), [])
  assert.deepEqual(codesOf({ modules: ['python'] }), ['not-allowed modules.0'])
  assert.deepEqual(codesOf({ modules: 'ts' }), ['wrong-type modules'])
  assert.deepEqual(codesOf({ checks: { structure: { limits: { fileLines: -1 } } } }), ['wrong-type checks.structure.limits.fileLines'])
  assert.deepEqual(codesOf({ checks: { structure: { limits: { fileLines: '500' } } } }), ['wrong-type checks.structure.limits.fileLines'])
  assert.deepEqual(codesOf({ checks: { structure: { readable: { enabled: 'yes' } } } }), ['wrong-type checks.structure.readable.enabled'])
  assert.deepEqual(codesOf({ checks: { guidance: { maxLines: { 'CLAUDE.md': 'short' } } } }), ['wrong-type checks.guidance.maxLines.CLAUDE.md'])
  assert.deepEqual(codesOf({ version: 2 }), ['not-allowed version'])
  assert.deepEqual(codesOf([]), ['wrong-type '])
  assert.deepEqual(codesOf({ checks: null }), ['wrong-type checks'])
})

test('목록 안의 항목도 검증한다', () => {
  const fact = { id: 'tool-count', doc: 'docs/api.md', pattern: '도구 (\\d+)개', source: { kind: 'count-files', glob: 'src/tools/*.ts' } }
  assert.deepEqual(codesOf({ checks: { 'docs-drift': { facts: [fact] } } }), [])
  assert.deepEqual(codesOf({ checks: { 'docs-drift': { facts: [{ ...fact, source: { kind: 'guess' } }] } } }), ['not-allowed checks.docs-drift.facts.0.source.kind'])
  assert.deepEqual(codesOf({ checks: { 'docs-drift': { facts: [{ id: 'x' }] } } }), [
    'missing-key checks.docs-drift.facts.0.doc', 'missing-key checks.docs-drift.facts.0.pattern', 'missing-key checks.docs-drift.facts.0.source',
  ])
  assert.deepEqual(codesOf({ checks: { audit: { allow: [{ id: 'GHSA-1', reason: 'dev only' }] } } }), ['missing-key checks.audit.allow.0.expires'])
  assert.deepEqual(codesOf({ checks: { exposure: { allow: [{ file: 'a.md', rule: 3, reason: 'ok', extra: 1 }] } } }), ['unknown-key checks.exposure.allow.0.extra'])
})

test('모르는 설정 키에서 게이트가 종료 코드 2 로 끝난다', async () => {
  const dir = makeProject({ checks: { structure: { mod: 'off' } } })
  const { code, output } = await gate(dir, [])
  assert.equal(code, 2)
  assert.match(output, /설정 오류/)
  assert.match(output, /checks\.structure\.mod: 모르는 키다\. 받는 키: mode \| source/)
})

test('설정이 JSON 이 아니거나 없으면 종료 코드 2 다', async () => {
  const broken = makeTempDir()
  writeFiles(broken, { 'lanekit.config.json': '{ "lang": ' })
  const brokenRun = await gate(broken, [])
  assert.equal(brokenRun.code, 2)
  assert.match(brokenRun.output, /JSON 으로 읽을 수 없다/)
  const missingRun = await gate(makeTempDir(), [])
  assert.equal(missingRun.code, 2)
  assert.match(missingRun.output, /lanekit\.config\.json 을 찾지 못했다/)
})

test('하위 폴더에서 돌려도 위로 올라가 설정을 찾는다', async () => {
  const dir = makeProject({ checks: { structure: { mod: 'off' } } }, { 'src/deep/.keep': '' })
  assert.equal((await gate(`${dir}/src/deep`, [])).code, 2)
})

test('켠 모듈의 폴더가 없으면 설정 오류(2)다', () => {
  // 저장소에는 modules/ 가 kit/ 옆에 있다. 그래서 kit 만 복사한 프로젝트에서 본다.
  const dir = makeProject({ modules: ['ts-fastify'] })
  cpSync(fileURLToPath(new URL('../kit', import.meta.url)), join(dir, 'scripts', 'lanekit'), { recursive: true })
  const ran = spawnSync(process.execPath, ['scripts/lanekit/gate.mjs', '--list'], { cwd: dir, encoding: 'utf8' })
  assert.equal(ran.status, 2)
  assert.match(ran.stdout, /모듈 폴더를 찾지 못했다: ts-fastify/)
})

test('등록표의 검사 ID 와 스키마의 검사 키가 같다', () => {
  assert.deepEqual([...REGISTERED_IDS].sort(), [...CHECK_IDS].sort())
})

test('견본 검사의 meta.defaultMode 가 스키마의 기본 모드와 같다', () => {
  assert.equal(guidanceMeta.defaultMode, validateConfig({}).config.checks.guidance.mode)
})
