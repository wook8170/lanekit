// 증거 파일 테스트 — 게이트를 돌릴 때마다 남는 기록의 위치와 내용을 본다.
// 대상: kit/lib/evidence.mjs · kit/lib/git.mjs 와 gate.mjs 의 프로필 실행.
// 먼저 읽을 파일: helpers.mjs.
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { createGit, withoutGitEnv } from '../kit/lib/git.mjs'
import { withEnv } from './check-helpers.mjs'
import { commitAll, finding, gate, git, makeProject, planStubResult, readJson, stubCheck, writeFiles } from './helpers.mjs'

const SECRET_LOOKING = 'token-value-that-must-not-leak'
const evidenceDir = (dir) => join(dir, '.lanekit', 'evidence')

function makeRepo(config = { checks: { structure: { mode: 'fail' }, writing: { mode: 'warn' } } }) {
  const dir = makeProject(config)
  planStubResult(dir, 'structure', { status: 'pass', metrics: { files: 3 }, current: {} })
  planStubResult(dir, 'writing', { status: 'findings', findings: [{ ...finding('docs/a.md'), message: SECRET_LOOKING }], current: {} })
  const commit = commitAll(dir)
  return { dir, commit, registry: [stubCheck('structure'), stubCheck('writing')] }
}

test('증거 파일이 <커밋 앞 12자>-<프로필>.json 으로 써진다', async () => {
  const { dir, commit, registry } = makeRepo()
  const { code, output } = await gate(dir, ['--profile', 'changed'], registry)
  assert.equal(code, 0)
  const file = join(evidenceDir(dir), `${commit.slice(0, 12)}-changed.json`)
  assert.ok(existsSync(file))
  assert.match(output, new RegExp(`증거 파일: \\.lanekit/evidence/${commit.slice(0, 12)}-changed\\.json`))

  const evidence = readJson(file)
  assert.equal(evidence.schema, 'lanekit-evidence/1')
  assert.equal(evidence.commit, commit)
  assert.equal(evidence.dirty, false)
  assert.equal(evidence.profile, 'changed')
  assert.equal(evidence.partial, false)
  assert.equal(evidence.node, process.version)
  assert.equal(evidence.lanekit, readJson(new URL('../package.json', import.meta.url)).version)
  assert.ok(Date.parse(evidence.startedAt) <= Date.parse(evidence.finishedAt))
  assert.deepEqual(evidence.failed, [])
  assert.deepEqual(evidence.checks.map((check) => [check.id, check.mode, check.status, check.verdict, check.findingCount]), [
    ['structure', 'fail', 'pass', 'pass', 0],
    ['writing', 'warn', 'findings', 'pass', 1],
  ])
  assert.deepEqual(evidence.checks[0].metrics, { files: 3 })
  assert.equal(typeof evidence.checks[0].durationMs, 'number')
})

test('증거 파일에는 찾은 것의 본문을 싣지 않는다', async () => {
  const { dir, registry } = makeRepo()
  await gate(dir, [], registry)
  const [name] = readdirSync(evidenceDir(dir))
  assert.equal(JSON.stringify(readJson(join(evidenceDir(dir), name))).includes(SECRET_LOOKING), false)
})

test('커밋하지 않은 변경이 있으면 dirty: true 다', async () => {
  const { dir, commit, registry } = makeRepo()
  writeFiles(dir, { 'src/new.ts': 'export const answer = 42\n' })
  const { output } = await gate(dir, [], registry)
  assert.equal(readJson(join(evidenceDir(dir), `${commit.slice(0, 12)}-light.json`)).dirty, true)
  assert.match(output, /커밋하지 않은 변경이 있다/)
})

test('증거 파일을 쓰는 것만으로는 dirty 가 되지 않는다', async () => {
  const { dir, commit, registry } = makeRepo()
  await gate(dir, [], registry)
  await gate(dir, [], registry)
  assert.equal(readJson(join(evidenceDir(dir), `${commit.slice(0, 12)}-light.json`)).dirty, false)
})

test('건너뛴 검사와 이유, 실패한 검사가 남는다', async () => {
  const { dir, commit, registry } = makeRepo()
  planStubResult(dir, 'writing', { status: 'error', summary: 'crashed' })
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'break writing')
  const head = git(dir, 'rev-parse', 'HEAD')
  assert.notEqual(head, commit)
  const { code } = await gate(dir, ['--skip', 'structure'], registry)
  assert.equal(code, 1)
  const evidence = readJson(join(evidenceDir(dir), `${head.slice(0, 12)}-light-partial.json`))
  assert.equal(evidence.partial, true, '--skip 으로 검사를 뺀 실행은 온전한 증거가 아니다')
  assert.deepEqual(evidence.skipped, [{ id: 'structure', mode: 'fail', reason: 'skipped-by-flag' }])
  assert.deepEqual(evidence.failed, ['writing'])
})

test('--only 로 일부만 돌린 기록은 -partial 로 따로 남는다', async () => {
  const { dir, commit, registry } = makeRepo()
  await gate(dir, ['--profile', 'full'], registry)
  await gate(dir, ['--profile', 'full', '--only', 'structure'], registry)
  const prefix = commit.slice(0, 12)
  assert.deepEqual(readdirSync(evidenceDir(dir)).sort(), [`${prefix}-full-partial.json`, `${prefix}-full.json`])
  assert.equal(readJson(join(evidenceDir(dir), `${prefix}-full.json`)).checks.length, 2, '온전한 기록은 그대로다')
  assert.equal(readJson(join(evidenceDir(dir), `${prefix}-full-partial.json`)).partial, true)
})

test('--no-evidence 면 쓰지 않는다', async () => {
  const { dir, registry } = makeRepo()
  const { output } = await gate(dir, ['--no-evidence'], registry)
  assert.equal(existsSync(evidenceDir(dir)), false)
  assert.match(output, /증거 파일을 쓰지 않았다/)
})

test('git 저장소가 아니면 커밋은 no-git, dirty 는 true 다', async () => {
  const dir = makeProject({ checks: { structure: { mode: 'warn' } } })
  planStubResult(dir, 'structure', { status: 'pass', current: {} })
  await gate(dir, [], [stubCheck('structure')])
  const evidence = readJson(join(evidenceDir(dir), 'no-git-light.json'))
  assert.equal(evidence.commit, 'no-git')
  assert.equal(evidence.dirty, true)
})

test('meta.afterEvidence 인 검사는 증거 파일을 쓴 뒤에 돌고 그 경로를 받는다', async () => {
  const dir = makeProject({ checks: { structure: { mode: 'fail' }, provenance: { mode: 'warn' } } })
  planStubResult(dir, 'structure', { status: 'pass', current: {} })
  planStubResult(dir, 'provenance', { status: 'pass' })
  const commit = commitAll(dir)
  const registry = [stubCheck('provenance', { profiles: ['full'], ratchetable: false, afterEvidence: true }), stubCheck('structure')]
  const { code, output } = await gate(dir, ['--profile', 'full'], registry)
  assert.equal(code, 0)
  const file = join(evidenceDir(dir), `${commit.slice(0, 12)}-full.json`)
  assert.equal(readJson(registry[0].seenFile).evidencePath, file)
  const evidence = readJson(file)
  assert.deepEqual(evidence.deferred, ['provenance'])
  assert.deepEqual(evidence.checks.map((check) => check.id), ['structure'])
  assert.match(output, /provenance\s+warn\s+통과/)
})

test('--json 은 찾은 것까지 든 전체 결과를 파일로 쓴다', async () => {
  const { dir, registry } = makeRepo()
  await gate(dir, ['--json', 'out/result.json', '--no-evidence'], registry)
  const written = readJson(join(dir, 'out/result.json'))
  assert.equal(written.run.profile, 'light')
  assert.equal(written.outcomes.find((outcome) => outcome.id === 'writing').findings[0].file, 'docs/a.md')
})

test('changed 프로필은 기준 브랜치에서 갈라진 뒤 바뀐 파일을 검사에 넘긴다', async () => {
  const { dir, registry } = makeRepo()
  git(dir, 'checkout', '-q', '-b', 'feature')
  writeFiles(dir, { 'src/changed.ts': 'export const changed = true\n', 'src/untracked.ts': 'export const fresh = true\n' })
  git(dir, 'add', 'src/changed.ts')
  git(dir, 'commit', '-q', '-m', 'change')
  await gate(dir, ['--profile', 'changed', '--no-evidence', '--only', 'structure'], registry)
  assert.deepEqual(readJson(registry[0].seenFile).changedFiles, ['src/changed.ts', 'src/untracked.ts'])
  await gate(dir, ['--no-evidence', '--only', 'structure'], registry)
  assert.equal(readJson(registry[0].seenFile).changedFiles, null, 'light 프로필에서는 null 이다')
})

test('full 프로필은 커밋하지 않은 변경이 있으면 검사가 모두 통과해도 1 로 끝난다', async () => {
  const dir = makeProject({})
  planStubResult(dir, 'structure', { status: 'pass' })
  const registry = [stubCheck('structure')]
  commitAll(dir)
  const clean = await gate(dir, ['--profile', 'full'], registry)
  assert.equal(clean.code, 0, clean.output)
  writeFiles(dir, { 'uncommitted.txt': 'x\n' })
  for (const argv of [['--profile', 'full'], ['--profile', 'full', '--only', 'structure'], ['--profile', 'full', '--no-evidence']]) {
    const dirty = await gate(dir, argv, registry)
    assert.equal(dirty.code, 1, argv.join(' '))
    assert.match(dirty.output, /커밋하지 않은 변경이 있어서 full 프로필은 실패로 끝난다/)
  }
  assert.equal((await gate(dir, ['--profile', 'light'], registry)).code, 0, 'light 프로필은 그대로 통과한다')
})

const hiddenStateOf = (dir) => createGit(dir).dirtyState()

test('작업 트리 상태는 저장소 설정으로 끌 수 없다: status.showUntrackedFiles=no 여도 추적하지 않는 파일을 센다', () => {
  const dir = makeProject({})
  commitAll(dir)
  git(dir, 'config', 'status.showUntrackedFiles', 'no')
  assert.equal(hiddenStateOf(dir), 'clean')
  writeFiles(dir, { 'helper/untracked.txt': 'x\n' })
  assert.equal(hiddenStateOf(dir), 'changes')
})

test('assume-unchanged · skip-worktree 표시가 있는 파일이 있으면 dirty 다', async () => {
  for (const flag of ['--assume-unchanged', '--skip-worktree']) {
    const dir = makeProject({}, { 'src/a.txt': 'committed\n' })
    planStubResult(dir, 'structure', { status: 'pass' })
    commitAll(dir)
    git(dir, 'update-index', flag, 'src/a.txt')
    writeFiles(dir, { 'src/a.txt': 'edited after commit\n' })
    assert.equal(git(dir, 'status', '--porcelain'), '', 'git status 는 이 변경을 알리지 않는다')
    assert.equal(hiddenStateOf(dir), 'hidden-flags', flag)
    const { code, output } = await gate(dir, ['--profile', 'full', '--no-evidence'], [stubCheck('structure')])
    assert.equal(code, 1, flag)
    assert.match(output, /assume-unchanged 나 skip-worktree 표시가 있는 파일이 있어서 full 프로필은 실패로 끝난다/)
  }
})

test('GIT_ 환경 변수로 다른 인덱스 · 다른 저장소를 읽게 하거나 dirty 판정을 끌 수 없다', async () => {
  const dir = makeProject({}, { 'src/a.txt': 'committed\n' })
  const commit = commitAll(dir)
  const other = makeProject({}, { 'other.txt': 'x\n' })
  commitAll(other)
  writeFiles(dir, { 'src/a.txt': 'edited\n' })
  // 고친 내용을 담은 다른 인덱스를 가리키면, 걸러 내지 않은 git 은 작업 트리가 그 인덱스와 같다고 답한다.
  const staleIndex = join(other, 'copied-index')
  git(dir, 'add', '-A')
  copyFileSync(join(dir, '.git', 'index'), staleIndex)
  git(dir, 'reset', '-q')
  await withEnv({ GIT_INDEX_FILE: staleIndex, GIT_DIR: join(other, '.git'), GIT_WORK_TREE: other }, () => {
    assert.equal(createGit(dir).head(), commit, '다른 저장소의 HEAD 를 읽지 않는다')
    assert.equal(hiddenStateOf(dir), 'changes')
  })
  // GIT_CONFIG_* 는 넘긴다(CI 의 safe.directory). 그 변수로 넣은 설정보다 명령의 -c 가 먼저라서 판정은 그대로다.
  git(dir, 'checkout', '-q', '--', 'src/a.txt')
  writeFiles(dir, { 'untracked.txt': 'x\n' })
  const injected = { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'status.showUntrackedFiles', GIT_CONFIG_VALUE_0: 'no', GIT_CONFIG_KEY_1: 'user.name', GIT_CONFIG_VALUE_1: 'from-env' }
  await withEnv(injected, () => {
    assert.equal(createGit(dir).tryRun(['config', '--get', 'user.name']), 'from-env', 'GIT_CONFIG_* 는 git 에 닿는다')
    assert.equal(hiddenStateOf(dir), 'changes')
  })
  const kept = { PATH: '/bin', GIT_CONFIG_COUNT: '1', GIT_SSH_COMMAND: 'ssh', GITHUB_TOKEN: 'kept' }
  const moved = { GIT_DIR: 'x', GIT_WORK_TREE: 'x', git_index_file: 'y', GIT_OBJECT_DIRECTORY: 'x', GIT_ALTERNATE_OBJECT_DIRECTORIES: 'x', GIT_COMMON_DIR: 'x' }
  assert.deepEqual(withoutGitEnv({ ...kept, ...moved }), kept)
})

test('git 저장소가 아닌 폴더에서 full 을 돌리면 커밋하지 않은 변경이 아니라 저장소가 아니라고 알린다', async () => {
  const dir = makeProject({})
  planStubResult(dir, 'structure', { status: 'pass' })
  const { code, output } = await gate(dir, ['--profile', 'full', '--no-evidence'], [stubCheck('structure')])
  assert.equal(code, 1)
  assert.match(output, /커밋 no-git · git 저장소가 아니다/)
  assert.match(output, /git 저장소가 아니라서 full 프로필은 실패로 끝난다/)
  assert.doesNotMatch(output, /커밋하지 않은 변경/)
})
