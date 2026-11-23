// init 실행 테스트 — 빈 저장소에 놓기, 이미 있는 파일을 덮어쓰지 않기, 두 번 실행해도 같은 결과, 레인키퍼가 없을 때와 있을 때를 본다.
// 대상: lib/init.mjs · lib/init-apply.mjs · lib/init-followup.mjs · lib/lanekeeper-link.mjs.
// 먼저 읽을 파일: ../lib/init.mjs.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { validateConfig } from '../kit/lib/config.mjs'
import { hasModeBits } from '../kit/lib/platform.mjs'
import * as init from '../lib/init.mjs'
import { fillMissing, lanekeeperValues } from '../lib/lanekeeper-link.mjs'
import { compareWithLock, listFiles } from '../lib/lock.mjs'
import { listPlaceholders } from '../lib/render.mjs'
import { git, makeTempDir, readJson } from './helpers.mjs'
import { FAKE_LANEKEEPER, makeMachine, makePluginRoot, makeRepo, runCommandModule, snapshotTree } from './scaffold-helpers.mjs'

const runInit = (cwd, argv, options = {}) => runCommandModule(init, { cwd, argv, machine: options.machine ?? makeMachine(), ...options })
const read = (dir, path) => readFileSync(join(dir, path), 'utf8')
const isExecutable = (file) => (statSync(file).mode & 0o111) !== 0

const ALWAYS_CREATED = [
  'lanekit.config.json',
  'scripts/lanekit/gate.mjs',
  'scripts/lanekit/lib/config.mjs',
  'scripts/lanekit/checks/guidance/run.mjs',
  'scripts/lanekit/git-hooks/pre-push',
  'scripts/lanekit/lanekit.lock.json',
  'AGENTS.md',
  'CLAUDE.md',
  'progress.md',
  'docs/decisions/README.md',
  'docs/decisions/0000-template.md',
  '.lanekeeper/briefs/common.md',
  'docs/memory-guide.md',
  'docs/release-checklist.md',
  '.gitignore',
  '.gitattributes',
  '.githooks/pre-push',
  '.lanekit/init-suggestions/memory/MEMORY.md',
  '.lanekit/init-suggestions/release-gates.md',
]

test('--yes 가 없으면 계획만 보여 주고 아무것도 쓰지 않는다', async () => {
  const dir = makeRepo()
  const { code, output } = await runInit(dir, [])
  assert.equal(code, 0)
  assert.match(output, /\+ AGENTS\.md/)
  assert.match(output, /아직 아무것도 쓰지 않았다/)
  assert.deepEqual(listFiles(dir).filter((path) => !path.startsWith('.git/')), [])
})

test('빈 저장소에 init 을 실행하면 놓기로 한 파일이 생긴다', async () => {
  const dir = makeRepo()
  const { code } = await runInit(dir, ['--yes'])
  assert.equal(code, 0)
  for (const path of ALWAYS_CREATED) assert.ok(existsSync(join(dir, path)), `${path} 가 있어야 한다`)
  if (hasModeBits()) assert.ok(isExecutable(join(dir, '.githooks/pre-push')))
  assert.equal(read(dir, '.gitattributes').includes('.githooks/pre-push text eol=lf'), true, '훅의 줄바꿈을 LF 로 묶는다')
  assert.deepEqual(read(dir, '.gitignore').split('\n').filter(Boolean), ['.lanekit/', '.env'])
  assert.deepEqual(validateConfig(readJson(join(dir, 'lanekit.config.json'))).problems, [])
  for (const path of ['.github', '.gitlab', 'CODEOWNERS']) assert.ok(!existsSync(join(dir, path)), `${path} 는 없어야 한다`)
})

test('복사 직후의 복사본은 잠금 파일과 같다', async () => {
  const dir = makeRepo()
  await runInit(dir, ['--yes'])
  const compared = compareWithLock(join(dir, 'scripts/lanekit'))
  assert.deepEqual({ modified: compared.modified, missing: compared.missing, extra: compared.extra }, { modified: [], missing: [], extra: [] })
  assert.ok(compared.same.includes('gate.mjs'))
})

test('원격 관문이 github · gitlab 이면 CI 틀과 CODEOWNERS 를 놓고, none 이면 훅도 놓지 않는다', async () => {
  const github = makeRepo()
  await runInit(github, ['--yes', '--remote-gate', 'github'])
  for (const path of ['.github/workflows/lanekit-gate.yml', '.github/CODEOWNERS', '.github/pull_request_template.md', '.githooks/pre-push']) {
    assert.ok(existsSync(join(github, path)), path)
  }
  const gitlab = makeRepo()
  await runInit(gitlab, ['--yes', '--remote-gate', 'gitlab'])
  for (const path of ['.gitlab/lanekit-gate.gitlab-ci.yml', 'CODEOWNERS', '.githooks/pre-push']) assert.ok(existsSync(join(gitlab, path)), path)
  const none = makeRepo()
  await runInit(none, ['--yes', '--remote-gate', 'none'])
  assert.ok(!existsSync(join(none, '.githooks')))
  assert.equal(readJson(join(none, 'lanekit.config.json')).remote_gate, 'none')
})

test('이미 있는 파일은 바뀌지 않고, 넣을 내용이 제안 폴더에 생긴다', async () => {
  const existing = {
    'AGENTS.md': '# 프로젝트가 쓴 지침\n',
    'progress.md': '# 프로젝트의 진행 상황\n',
    '.gitignore': 'node_modules/\n',
    'lanekit.config.json': '{ "version": 1, "lang": "ko", "modules": [] }\n',
    'scripts/lanekit/gate.mjs': '// 프로젝트가 미리 둔 파일\n',
  }
  const dir = makeRepo(existing)
  const { output } = await runInit(dir, ['--yes'])
  for (const [path, content] of Object.entries(existing)) assert.equal(read(dir, path), content, `${path} 는 그대로여야 한다`)
  for (const path of ['AGENTS.md', 'progress.md', '.gitignore', 'lanekit.config.json', 'scripts/lanekit/gate.mjs']) {
    assert.ok(existsSync(join(dir, '.lanekit/init-suggestions', path)), `${path} 의 제안 파일이 있어야 한다`)
  }
  assert.match(read(dir, '.lanekit/init-suggestions/AGENTS.md'), /작업 지침/)
  assert.equal(read(dir, '.lanekit/init-suggestions/.gitignore'), 'node_modules/\n.lanekit/\n.env\n')
  assert.match(output, /AGENTS\.md → \.lanekit\/init-suggestions\/AGENTS\.md/)
  assert.match(output, /--edit-gitignore/)
  assert.ok(existsSync(join(dir, 'CLAUDE.md')), '없던 파일은 새로 쓴다')
})

test('--edit-gitignore 를 주면 있는 .gitignore 에 빠진 줄만 덧붙인다', async () => {
  const dir = makeRepo({ '.gitignore': 'node_modules/\n.env\n' })
  await runInit(dir, ['--yes', '--edit-gitignore'])
  assert.equal(read(dir, '.gitignore'), 'node_modules/\n.env\n.lanekit/\n')
  assert.ok(!existsSync(join(dir, '.lanekit/init-suggestions/.gitignore')))
})

test('init 을 두 번 실행해도 결과가 같다', async () => {
  const dir = makeRepo({ 'AGENTS.md': '# 프로젝트가 쓴 지침\n' })
  const machine = makeMachine()
  await runInit(dir, ['--yes'], { machine })
  const skipped = ['.git/', '.lanekit/evidence/']
  const first = snapshotTree(dir, skipped)
  const second = await runInit(dir, ['--yes'], { machine })
  assert.equal(second.code, 0)
  assert.deepEqual(snapshotTree(dir, skipped), first)
  assert.match(second.output, /새로 쓴 파일이 없다/)
})

test('레인키퍼가 없는 머신에서도 init 이 끝나고, 넣을 값을 제안으로 둔다', async () => {
  const dir = makeRepo()
  const { code, output } = await runInit(dir, ['--yes'])
  assert.equal(code, 0)
  assert.match(output, /레인키퍼 명령이 없어서 레인키퍼 init 과 위키 연결을 건너뛰었다/)
  assert.ok(!existsSync(join(dir, '.lanekeeper/config.json')))
  assert.deepEqual(readJson(join(dir, '.lanekit/init-suggestions/.lanekeeper/config.json')), lanekeeperValues('ko'))
  assert.match(output, /✗ P1 /, 'doctor 가 플러그인이 없음을 알린다')
})

test('레인키퍼가 있으면 그 init 으로 설정을 만들고 게이트 · 출하 관문 · 레인 커밋을 채운다', async () => {
  const dir = makeRepo()
  const machine = makeMachine({ bin: { 'lanekeeper-config': FAKE_LANEKEEPER } })
  const { output } = await runInit(dir, ['--yes', '--kind', 'library'], { machine })
  const config = readJson(join(dir, '.lanekeeper/config.json'))
  assert.equal(config.project_kind, 'library', '레인키퍼 init 에 종류를 넘긴다')
  assert.equal(config.gate.command, 'node scripts/lanekit/gate.mjs --profile light')
  assert.deepEqual(config.release.gates, [{ name: 'lanekit-full', command: 'node scripts/lanekit/gate.mjs --profile full', required: true }])
  assert.deepEqual(config.lanes, { commit: 'allowed' }, '레인 커밋은 레인키퍼의 값 이름을 쓴다')
  assert.equal(config.paths.lane_reports, '.lanekit/reports/{lane}.md')
  assert.equal(config.paths.decisions, 'docs/decisions/{date}-{slug}.md')
  assert.equal(config.code_standards.doc, 'AGENTS.md#코드-작성-기준')
  assert.match(output, /\.lanekeeper\/config\.json/)
  const again = await runInit(dir, ['--yes'], { machine })
  assert.match(again.output, /lanekit 의 값이 이미 있다/)
  assert.ok(!existsSync(join(dir, '.lanekit/init-suggestions/.lanekeeper')))
})

test('이미 있는 레인키퍼 설정은 고치지 않고, 빠진 칸을 채운 내용을 제안으로 둔다', async () => {
  const mine = { version: 1, gate: { command: 'npm run verify' }, lanes: { commit: 'on-instruction' } }
  const dir = makeRepo({ '.lanekeeper/config.json': mine })
  const before = read(dir, '.lanekeeper/config.json')
  await runInit(dir, ['--yes'], { machine: makeMachine({ bin: { 'lanekeeper-config': FAKE_LANEKEEPER } }) })
  assert.equal(read(dir, '.lanekeeper/config.json'), before)
  const suggested = readJson(join(dir, '.lanekit/init-suggestions/.lanekeeper/config.json'))
  assert.equal(suggested.gate.command, 'npm run verify', '이미 있는 값은 바꾸지 않는다')
  assert.equal(suggested.lanes.commit, 'on-instruction')
  assert.equal(suggested.release.gates[0].name, 'lanekit-full')
})

test('fillMissing 은 없는 칸만 채운다', () => {
  const filled = fillMissing({ gate: { command: 'x', verify_all: '' }, release: { gates: [] } }, { gate: { command: 'y', verify_all: 'z' }, release: { gates: [1] }, lanes: { commit: 'allowed' } })
  assert.deepEqual(filled, { gate: { command: 'x', verify_all: 'z' }, release: { gates: [1] }, lanes: { commit: 'allowed' } })
})

test('언어를 en 으로 고르면 영어 틀을 놓고 설정에 적는다', async () => {
  const dir = makeRepo()
  const { output } = await runInit(dir, ['--yes'], { lang: 'en' })
  assert.match(read(dir, 'AGENTS.md'), /working guide/)
  assert.match(read(dir, 'AGENTS.md'), /## Code standards/)
  assert.equal(readJson(join(dir, 'lanekit.config.json')).lang, 'en')
  assert.match(output, /Files written/)
})

test('--lang 이 없으면 레인키퍼 개인 설정의 언어를 쓴다', async () => {
  const dir = makeRepo()
  await runInit(dir, ['--yes'], { machine: makeMachine({ home: { '.lanekeeper/personal.json': { version: 1, language: 'en' } } }) })
  assert.equal(readJson(join(dir, 'lanekit.config.json')).lang, 'en')
  assert.match(read(dir, 'CLAUDE.md'), /Read `AGENTS\.md` first/)
})

test('놓은 파일에 자리표시가 남지 않는다', async () => {
  for (const lang of ['ko', 'en']) {
    for (const remoteGate of ['github', 'gitlab']) {
      const dir = makeRepo({ 'package.json': { name: 'acme-app' }, 'package-lock.json': '{}\n' })
      await runInit(dir, ['--yes', '--remote-gate', remoteGate], { lang })
      const written = listFiles(dir).filter((path) => !path.startsWith('.git/') && !path.startsWith('scripts/lanekit/'))
      for (const path of written) assert.deepEqual(listPlaceholders(read(dir, path)), [], `${lang} ${remoteGate} ${path}`)
      assert.match(read(dir, 'AGENTS.md'), /^# acme-app /)
      const ciFile = remoteGate === 'github' ? '.github/workflows/lanekit-gate.yml' : '.gitlab/lanekit-gate.gitlab-ci.yml'
      assert.match(read(dir, ciFile), /npm ci/)
      assert.match(read(dir, ciFile), /gate\.mjs --profile changed/)
    }
  }
})

test('--set-hooks-path 는 git 훅 폴더를 설정하고, 주지 않으면 설정하지 않고 방법을 알린다', async () => {
  const machine = makeMachine()
  const plain = makeRepo()
  const asked = await runInit(plain, ['--yes'], { machine })
  assert.match(asked.output, /--set-hooks-path/)
  assert.throws(() => git(plain, 'config', '--local', '--get', 'core.hooksPath'))
  const dir = makeRepo()
  await runInit(dir, ['--yes', '--set-hooks-path'], { machine })
  assert.equal(git(dir, 'config', '--local', '--get', 'core.hooksPath'), '.githooks')
})

test('심볼릭 링크를 따라 저장소 밖에 쓰지 않고, 폴더 자리에 파일이 있어도 끝까지 돈다', async () => {
  const outside = makeTempDir()
  const dir = makeRepo({ docs: '폴더가 아니라 파일이다\n' })
  symlinkSync(join(outside, 'AGENTS.md'), join(dir, 'AGENTS.md'))
  symlinkSync(outside, join(dir, '.githooks'), 'dir')
  const { code, output } = await runInit(dir, ['--yes'])
  assert.equal(code, 0)
  assert.deepEqual(readdirSync(outside), [], '저장소 밖에는 아무것도 쓰지 않는다')
  assert.equal(read(dir, 'docs'), '폴더가 아니라 파일이다\n')
  for (const path of ['AGENTS.md', '.githooks/pre-push', 'docs/decisions/README.md']) assert.match(output, new RegExp(`쓰지 않는다: ${path.replaceAll('.', '\\.')}`))
  assert.ok(existsSync(join(dir, 'scripts/lanekit/gate.mjs')), '막히지 않은 파일은 쓴다')
})

test('.gitignore 가 심볼릭 링크면 --edit-gitignore 를 줘도 링크가 가리키는 파일을 고치지 않는다', async () => {
  const outside = makeTempDir()
  writeFileSync(join(outside, 'shared-ignore'), 'shared-ignore\n')
  const linked = makeRepo()
  symlinkSync(join(outside, 'shared-ignore'), join(linked, '.gitignore'))
  const { code, output } = await runInit(linked, ['--yes', '--edit-gitignore'])
  assert.equal(code, 0)
  assert.equal(read(outside, 'shared-ignore'), 'shared-ignore\n')
  assert.match(output, /쓰지 않는다: \.gitignore/)

  const dangling = makeRepo()
  symlinkSync(join(outside, 'not-yet'), join(dangling, '.gitignore'))
  await runInit(dangling, ['--yes'])
  assert.deepEqual(readdirSync(outside), ['shared-ignore'], '끊긴 링크를 따라 저장소 밖에 파일을 만들지 않는다')
})

test('제안 폴더와 레인키퍼 설정이 저장소 밖을 가리키면 쓰지 않고 알린다', async () => {
  const outside = makeTempDir()
  const suggesting = makeRepo({ '.gitignore': 'node_modules/\n' })
  symlinkSync(outside, join(suggesting, '.lanekit'), 'dir')
  const suggested = await runInit(suggesting, ['--yes'])
  assert.equal(suggested.code, 0)
  assert.ok(!existsSync(join(outside, 'init-suggestions')), '제안을 저장소 밖에 두지 않는다')
  assert.match(suggested.output, /쓰지 않는다: \.lanekit\/init-suggestions\/\.lanekeeper\/config\.json/)
  assert.match(suggested.output, /쓰지 않는다: \.lanekit\/init-suggestions\/\.gitignore/)

  const elsewhere = makeTempDir()
  const linking = makeRepo()
  symlinkSync(elsewhere, join(linking, '.lanekeeper'), 'dir')
  const linked = await runInit(linking, ['--yes'], { machine: makeMachine({ bin: { 'lanekeeper-config': FAKE_LANEKEEPER } }) })
  assert.equal(linked.code, 0)
  assert.equal(readJson(join(elsewhere, 'config.json')).release, undefined, '레인키퍼가 만든 저장소 밖 파일에 lanekit 의 값을 채우지 않는다')
  assert.match(linked.output, /쓰지 않는다: \.lanekeeper\/config\.json/)
})

test('이미 다른 훅 폴더를 쓰는 저장소의 설정은 바꾸지 않고 알린다', async () => {
  const dir = makeRepo()
  git(dir, 'config', '--local', 'core.hooksPath', '.husky')
  const { output } = await runInit(dir, ['--yes', '--set-hooks-path'], { machine: makeMachine() })
  assert.equal(git(dir, 'config', '--local', '--get', 'core.hooksPath'), '.husky')
  assert.match(output, /이미 \.husky 로 설정돼 있어 바꾸지 않았다/)
})

test('--lock-baselines 는 기준선과 재잠금 이력을 쓰고 모드는 warn 그대로 둔다', async () => {
  const dir = makeRepo()
  const { output } = await runInit(dir, ['--yes', '--lock-baselines'])
  assert.ok(existsSync(join(dir, 'scripts/lanekit/baselines/guidance.json')))
  const log = read(dir, 'scripts/lanekit/baselines/relock-log.jsonl').trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(log[0].reason, 'init')
  assert.equal(readJson(join(dir, 'lanekit.config.json')).checks.guidance.mode, 'warn')
  assert.match(output, /scripts\/lanekit\/baselines\//)
  const compared = compareWithLock(join(dir, 'scripts/lanekit'))
  assert.deepEqual(compared.extra, [], '기준선은 잠금 대상이 아니다')
})

test('켠 모듈의 파일을 scripts/lanekit/modules/ 로 복사하고, 설치본에 없는 모듈은 알린다', async () => {
  const dir = makeRepo()
  const pluginRoot = makePluginRoot({ modules: ['ts'] })
  const { output } = await runInit(dir, ['--yes', '--modules', 'ts,ts-fastify'], { pluginRoot })
  assert.ok(existsSync(join(dir, 'scripts/lanekit/modules/ts/module.json')))
  assert.ok(compareWithLock(join(dir, 'scripts/lanekit')).same.includes('modules/ts/module.json'))
  assert.deepEqual(readJson(join(dir, 'lanekit.config.json')).modules, ['ts', 'ts-fastify'])
  if (!existsSync(join(pluginRoot, 'modules/ts-fastify'))) assert.match(output, /모듈 `ts-fastify` 의 파일이 이 설치본에 없어서/)
})

test('init 은 게이트를 한 번 돌려 지금 값을 보여 주고, 커밋하지 않는다', async () => {
  const dir = makeRepo()
  const { output } = await runInit(dir, ['--yes'])
  assert.match(output, /게이트 첫 실행\(light\)/)
  assert.match(output, /guidance\s+warn/)
  assert.match(output, /게이트 종료 코드: \d/)
  assert.match(output, /커밋할 경로/)
  assert.throws(() => git(dir, 'rev-parse', 'HEAD'), 'init 은 커밋을 만들지 않는다')
})

test('모르는 플래그와 받지 않는 값은 종료 코드 2 다', async () => {
  const dir = makeRepo()
  assert.equal((await runInit(dir, ['--force'])).code, 2)
  const bad = await runInit(dir, ['--kind', 'desktop'])
  assert.equal(bad.code, 2)
  assert.match(bad.output, /받지 않는 값이다: --kind desktop/)
  assert.deepEqual(listFiles(dir).filter((path) => !path.startsWith('.git/')), [])
})
