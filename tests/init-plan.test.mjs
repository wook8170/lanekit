// init 판정 테스트 — 감지, 답 확정, 설정 내용, 만들 파일 목록, 이미 있는 파일의 처리, .gitignore, 인자 해석을 본다.
// 대상: lib/detect.mjs · lib/init-plan.mjs · lib/flags.mjs · lib/render.mjs · lib/init.mjs 의 pickInitLang.
// 먼저 읽을 파일: ../lib/init-plan.mjs.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateConfig } from '../kit/lib/config.mjs'
import { detectProject, guessKind, guessModules, guessRemoteGate, guessTestCommands } from '../lib/detect.mjs'
import { FlagError, parseFlags, splitList } from '../lib/flags.mjs'
import { pickInitLang } from '../lib/init.mjs'
import { buildConfig, listTargets, planGitignore, planInit, resolveAnswers } from '../lib/init-plan.mjs'
import { runCommand } from '../lib/process.mjs'
import { listPlaceholders, renderTemplate } from '../lib/render.mjs'
import { OFFERED_TEMPLATES, TEMPLATE_TARGETS } from '../lib/template-map.mjs'
import { git } from './helpers.mjs'
import { makeMachine, makeRepo } from './scaffold-helpers.mjs'

const DETECTED = {
  projectName: 'acme-app',
  packageManager: 'npm',
  kind: 'service',
  modules: ['ts'],
  tests: { full: 'npm test', changed: '' },
  docsDir: 'docs',
  remoteGate: 'git-hook',
}
const ANSWERS = resolveAnswers({}, DETECTED, 'ko')
const allSources = () => [...TEMPLATE_TARGETS, ...OFFERED_TEMPLATES].map((entry) => entry.source)
const SOURCES = {
  templates: Object.fromEntries(allSources().map((source) => [source, `{{project}} ${source}\n`])),
  kitFiles: [
    { path: 'gate.mjs', content: Buffer.from('gate\n'), hash: 'aaa', executable: false },
    { path: 'git-hooks/pre-push', content: Buffer.from('#!/bin/sh\n'), hash: 'bbb', executable: true },
  ],
  version: '0.1.0',
}
const pathsOf = (answers) => listTargets(answers, DETECTED, SOURCES).map((target) => target.path)

test('의존성으로 프로젝트 종류를 고른다', () => {
  assert.equal(guessKind({}, ['react', 'typescript']), 'web-ui')
  assert.equal(guessKind({}, ['fastify']), 'service')
  assert.equal(guessKind({ main: 'index.js' }, []), 'library')
  assert.equal(guessKind({}, []), 'other')
})

test('typescript 가 있으면 ts 를, fastify 도 있으면 ts-fastify 를 함께 권한다', () => {
  assert.deepEqual(guessModules(['typescript']), ['ts'])
  assert.deepEqual(guessModules(['typescript', 'fastify']), ['ts', 'ts-fastify'])
  assert.deepEqual(guessModules(['fastify']), [])
})

test('원격 주소로 원격 관문을 고르고, 모르는 호스트는 git 훅만 쓴다', () => {
  assert.equal(guessRemoteGate('git@github.com:acme/acme-app.git'), 'github')
  assert.equal(guessRemoteGate('https://gitlab.example.com/acme/acme-app.git'), 'gitlab')
  assert.equal(guessRemoteGate('https://git.example.com/acme/acme-app.git'), 'git-hook')
  assert.equal(guessRemoteGate(''), 'git-hook')
})

test('테스트 명령은 test 스크립트와 테스트 도구로 정하고, 알 수 없으면 비워 둔다', () => {
  assert.deepEqual(guessTestCommands({ scripts: { test: 'vitest run' } }, ['vitest'], 'pnpm'), {
    full: 'pnpm test',
    changed: 'pnpm exec vitest related --run {files}',
  })
  assert.deepEqual(guessTestCommands({ scripts: { test: 'jest' } }, ['jest'], null), { full: 'npm test', changed: 'npx jest --findRelatedTests {files}' })
  assert.deepEqual(guessTestCommands({}, [], 'yarn'), { full: '', changed: '' })
})

test('저장소를 읽어 패키지 관리자 · 문서 폴더 · 원격 종류 · 이름을 감지한다', () => {
  const dir = makeRepo({
    'package.json': { name: 'acme-app', scripts: { test: 'node --test' }, devDependencies: { typescript: '5.0.0' }, dependencies: { fastify: '5.0.0' } },
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
    'doc/readme.md': '# doc\n',
  })
  git(dir, 'remote', 'add', 'origin', 'https://github.com/acme/acme-app.git')
  const machine = makeMachine()
  const detected = detectProject(dir, (command, args) => runCommand(command, args, { cwd: dir, env: machine.env }))
  assert.deepEqual(detected, {
    projectName: 'acme-app',
    packageManager: 'pnpm',
    kind: 'service',
    modules: ['ts', 'ts-fastify'],
    tests: { full: 'pnpm test', changed: '' },
    docsDir: 'doc',
    remoteGate: 'github',
  })
})

test('package.json 이 없거나 깨져도 감지는 끝난다', () => {
  const machine = makeMachine()
  const dir = makeRepo({ 'package.json': '{ not json' })
  const detected = detectProject(dir, (command, args) => runCommand(command, args, { cwd: dir, env: machine.env }))
  assert.equal(detected.kind, 'other')
  assert.equal(detected.packageManager, null)
  assert.deepEqual(detected.modules, [])
  assert.equal(detected.docsDir, null)
})

test('플래그가 있으면 그 값을, 없으면 감지 결과를 쓴다', () => {
  assert.deepEqual(ANSWERS, { lang: 'ko', kind: 'service', modules: ['ts'], tests: { full: 'npm test', changed: '' }, remoteGate: 'git-hook' })
  const flags = { kind: 'library', modules: 'none', 'test-full': '', 'test-changed': 'x {files}', 'remote-gate': 'gitlab' }
  assert.deepEqual(resolveAnswers(flags, DETECTED, 'en'), {
    lang: 'en',
    kind: 'library',
    modules: [],
    tests: { full: '', changed: 'x {files}' },
    remoteGate: 'gitlab',
  })
})

test('받지 않는 값은 FlagError 로 알린다', () => {
  for (const flags of [{ kind: 'desktop' }, { modules: 'python' }, { 'remote-gate': 'bitbucket' }]) {
    assert.throws(() => resolveAnswers(flags, DETECTED, 'ko'), (error) => error instanceof FlagError && error.code === 'bad-value')
  }
})

test('언어는 --lang → 이미 있는 설정 → 레인키퍼 개인 설정 → ko 순서로 고른다', () => {
  assert.equal(pickInitLang({ requested: 'en', configured: 'ko', personal: 'ko' }), 'en')
  assert.equal(pickInitLang({ requested: undefined, configured: 'en', personal: 'ko' }), 'en')
  assert.equal(pickInitLang({ requested: undefined, configured: undefined, personal: 'en' }), 'en')
  assert.equal(pickInitLang({ requested: 'fr', configured: undefined, personal: undefined }), 'ko')
})

test('만든 설정은 스키마에 맞고, 답과 검사별 기본 모드가 들어 있다', () => {
  const config = buildConfig(ANSWERS, DETECTED)
  assert.deepEqual(validateConfig(config).problems, [])
  assert.equal(config.repo.visibility, 'private')
  assert.deepEqual(config.modules, ['ts'])
  assert.deepEqual(config.checks.tests, { mode: 'fail', full: 'npm test', changed: '' })
  assert.equal(config.checks.structure.mode, 'warn')
  assert.equal(config.checks.secrets.mode, 'fail')
  assert.equal(config.checks.exposure.mode, 'auto')
  assert.equal(config.checks.writing.globs, undefined)
})

test('문서 폴더가 docs 가 아니면 글쓰기 검사의 대상을 그 폴더로 적는다', () => {
  const config = buildConfig(ANSWERS, { ...DETECTED, docsDir: 'documentation' })
  assert.deepEqual(config.checks.writing.globs, ['documentation/**/*.md', 'README*.md'])
  assert.deepEqual(validateConfig(config).problems, [])
})

test('원격 관문에 따라 만드는 파일이 달라진다', () => {
  const common = ['lanekit.config.json', 'scripts/lanekit/gate.mjs', 'scripts/lanekit/lanekit.lock.json', 'AGENTS.md', 'CLAUDE.md', 'progress.md']
  const hook = '.githooks/pre-push'
  const github = ['.github/workflows/lanekit-gate.yml', '.github/CODEOWNERS', '.github/pull_request_template.md']
  const gitlab = ['.gitlab/lanekit-gate.gitlab-ci.yml', 'CODEOWNERS']
  const cases = [
    ['git-hook', [hook], [...github, ...gitlab]],
    ['github', [hook, ...github], gitlab],
    ['gitlab', [hook, ...gitlab], github],
    ['none', [], [hook, ...github, ...gitlab]],
  ]
  for (const [remoteGate, present, absent] of cases) {
    const paths = pathsOf({ ...ANSWERS, remoteGate })
    for (const path of [...common, ...present]) assert.ok(paths.includes(path), `${remoteGate}: ${path} 가 있어야 한다`)
    for (const path of absent) assert.ok(!paths.includes(path), `${remoteGate}: ${path} 가 없어야 한다`)
  }
})

test('틀은 자리표시를 채워서 놓고, 잠금 파일에는 원본의 해시를 적는다', () => {
  const targets = listTargets(ANSWERS, DETECTED, SOURCES)
  const find = (path) => targets.find((target) => target.path === path)
  assert.equal(find('AGENTS.md').content.toString(), 'acme-app AGENTS.md\n')
  assert.deepEqual(JSON.parse(find('scripts/lanekit/lanekit.lock.json').content.toString()), {
    schema: 'lanekit-lock/1',
    version: '0.1.0',
    files: { 'gate.mjs': 'aaa', 'git-hooks/pre-push': 'bbb' },
  })
  assert.equal(find('.githooks/pre-push').executable, true)
  assert.equal(find('.lanekit/init-suggestions/memory/MEMORY.md').group, 'offer')
})

test('이미 있는 파일은 덮어쓰지 않는다: 같으면 keep, 다르면 제안 폴더로 보낸다', () => {
  const targets = listTargets(ANSWERS, DETECTED, SOURCES)
  const existing = {
    'AGENTS.md': Buffer.from('프로젝트가 쓴 지침\n'),
    'CLAUDE.md': Buffer.from('acme-app CLAUDE.md\n'),
    'scripts/lanekit/lanekit.lock.json': Buffer.from('{}\n'),
    '.lanekit/init-suggestions/release-gates.md': Buffer.from('옛 제안\n'),
  }
  const plan = Object.fromEntries(planInit(targets, existing).map((entry) => [entry.path, entry]))
  assert.equal(plan['AGENTS.md'].action, 'suggest')
  assert.equal(plan['AGENTS.md'].writePath, '.lanekit/init-suggestions/AGENTS.md')
  assert.equal(plan['CLAUDE.md'].action, 'keep')
  assert.equal(plan['progress.md'].action, 'write')
  assert.equal(plan['progress.md'].writePath, 'progress.md')
  assert.equal(plan['scripts/lanekit/lanekit.lock.json'].action, 'keep', '잠금 파일은 한 번 쓴 뒤에는 update 만 바꾼다')
  assert.equal(plan['.lanekit/init-suggestions/release-gates.md'].action, 'write', '제안 폴더는 lanekit 의 것이라 다시 쓴다')
})

test('.gitignore 가 없으면 만들고, 있으면 허락이 있을 때만 덧붙인다', () => {
  assert.deepEqual(planGitignore(undefined, false), { action: 'write', missing: ['.lanekit/', '.env'], content: '.lanekit/\n.env\n' })
  assert.equal(planGitignore('node_modules/\n.lanekit/\n.env\n', false).action, 'keep')
  assert.equal(planGitignore('.lanekit\n.env\n', false).action, 'keep')
  const suggested = planGitignore('node_modules/', false)
  assert.equal(suggested.action, 'suggest')
  assert.equal(suggested.content, 'node_modules/\n.lanekit/\n.env\n')
  const appended = planGitignore('node_modules/\n.env\n', true)
  assert.deepEqual({ action: appended.action, missing: appended.missing }, { action: 'append', missing: ['.lanekit/'] })
  assert.equal(appended.content, 'node_modules/\n.env\n.lanekit/\n')
})

test('자리표시를 채우고, 값이 없는 자리표시는 오류로 알린다', () => {
  assert.equal(renderTemplate('# {{project}}\n{{project}}', { project: 'acme-app' }), '# acme-app\nacme-app')
  assert.deepEqual(listPlaceholders('{{project}} ${{ github.sha }} {{install_command}}'), ['project', 'install_command'])
  assert.throws(() => renderTemplate('{{project}} {{owner}}', { project: 'acme-app' }), /owner/)
})

test('인자는 선언한 플래그만 받는다', () => {
  const spec = { '--kind': 'value', '--yes': 'switch' }
  assert.deepEqual(parseFlags(['--kind', 'service', '--yes'], spec), { kind: 'service', yes: true })
  assert.throws(() => parseFlags(['--force'], spec), (error) => error instanceof FlagError && error.code === 'unknown-flag')
  assert.throws(() => parseFlags(['--kind'], spec), (error) => error instanceof FlagError && error.code === 'missing-value')
  assert.deepEqual(splitList('ts, ts-fastify'), ['ts', 'ts-fastify'])
  assert.deepEqual(splitList('none'), [])
  assert.deepEqual(splitList(undefined), [])
})
