// update 테스트 — 파일마다 할 일을 정하는 판정과, 원본 그대로인 파일만 바꾸고 고친 파일은 남기는 실행을 본다.
// 대상: lib/update-plan.mjs · lib/update.mjs · lib/kit-source.mjs.
// 먼저 읽을 파일: ../lib/update-plan.mjs.
import assert from 'node:assert/strict'
import { appendFileSync, copyFileSync, existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import * as init from '../lib/init.mjs'
import { compareWithLock, readLock } from '../lib/lock.mjs'
import * as update from '../lib/update.mjs'
import { groupByAction, hasChanges, planUpdate } from '../lib/update-plan.mjs'
import { makeTempDir } from './helpers.mjs'
import { makeMachine, makePluginRoot, makeRepo, runCommandModule, snapshotTree } from './scaffold-helpers.mjs'

const NEW_VERSION = '9.9.9'
const read = (dir, path) => readFileSync(join(dir, path), 'utf8')
const actionsOf = (hashes, force) => Object.fromEntries(planUpdate(hashes, force).map(({ path, action }) => [path, action]))

async function makeInstalledRepo(argv = []) {
  const dir = makeRepo()
  await runCommandModule(init, { cwd: dir, argv: ['--yes', ...argv], machine: makeMachine() })
  return dir
}

// 「새 버전」의 플러그인 사본: 실행기 한 파일을 고치고, 파일 하나를 더하고, 하나를 뺀다.
function makeNewPlugin() {
  return makePluginRoot({
    edit(dir) {
      appendFileSync(join(dir, 'kit/lib/report.mjs'), '\n// changed upstream\n')
      writeFileSync(join(dir, 'kit/lib/added.mjs'), 'export const added = true\n')
      rmSync(join(dir, 'kit/lib/markdown.mjs'))
    },
  })
}
const runUpdate = (cwd, argv, pluginRoot) => runCommandModule(update, { cwd, argv, pluginRoot, version: NEW_VERSION })

test('판정: 새 원본에 있는 파일', () => {
  const hashes = {
    locked: { same: 'a', changed: 'a', edited: 'a', editedSame: 'a', lost: 'a' },
    actual: { same: 'a', changed: 'a', edited: 'x', editedSame: 'b', stray: 'x' },
    incoming: { same: 'a', changed: 'b', edited: 'b', editedSame: 'b', lost: 'b', added: 'b', stray: 'b' },
  }
  assert.deepEqual(actionsOf(hashes), {
    same: 'current',
    changed: 'replace',
    edited: 'conflict',
    editedSame: 'current',
    lost: 'restore',
    added: 'add',
    stray: 'conflict',
  })
})

test('판정: 새 원본에서 빠진 파일', () => {
  const hashes = { locked: { untouched: 'a', edited: 'a', gone: 'a' }, actual: { untouched: 'a', edited: 'x' }, incoming: {} }
  assert.deepEqual(actionsOf(hashes), { untouched: 'remove', edited: 'orphan', gone: 'gone' })
})

test('판정: force 로 지정한 파일만 덮어쓰고, all 이면 모두 덮어쓴다', () => {
  const hashes = { locked: { one: 'a', two: 'a', old: 'a' }, actual: { one: 'x', two: 'y', old: 'z' }, incoming: { one: 'b', two: 'b' } }
  assert.deepEqual(actionsOf(hashes, ['one']), { one: 'overwrite', two: 'conflict', old: 'orphan' })
  assert.deepEqual(actionsOf(hashes, ['all']), { one: 'overwrite', two: 'overwrite', old: 'remove' })
})

test('판정: 바꿀 일이 있는지와 동작별 묶음', () => {
  const actions = [{ path: 'one', action: 'current' }, { path: 'two', action: 'conflict' }, { path: 'three', action: 'conflict' }]
  assert.equal(hasChanges(actions), false)
  assert.equal(hasChanges([...actions, { path: 'four', action: 'replace' }]), true)
  assert.deepEqual(groupByAction(actions), { current: ['one'], conflict: ['two', 'three'] })
})

test('복사본이 없으면 init 을 안내하고 종료 코드 2 다', async () => {
  const { code, output } = await runUpdate(makeRepo(), [], makeNewPlugin())
  assert.equal(code, 2)
  assert.match(output, /lanekit init/)
})

test('버전과 원본이 같으면 바꿀 것이 없다', async () => {
  const dir = await makeInstalledRepo()
  const { code, output } = await runCommandModule(update, { cwd: dir, argv: ['--yes'] })
  assert.equal(code, 0)
  assert.match(output, /바꿀 것이 없다/)
})

test('--yes 가 없으면 계획만 보여 주고 아무것도 바꾸지 않는다', async () => {
  const dir = await makeInstalledRepo()
  const before = snapshotTree(dir, ['.git/'])
  const { code, output } = await runUpdate(dir, [], makeNewPlugin())
  assert.equal(code, 0)
  assert.match(output, /새 원본으로 바꾸는 파일 1개\n {2}lib\/report\.mjs/)
  assert.match(output, /새로 생긴 파일 1개\n {2}lib\/added\.mjs/)
  assert.match(output, /원본에서 빠져 지우는 파일 1개\n {2}lib\/markdown\.mjs/)
  assert.match(output, /아직 아무것도 바꾸지 않았다/)
  assert.deepEqual(snapshotTree(dir, ['.git/']), before)
})

test('원본 그대로인 파일만 바꾸고, 프로젝트가 고친 파일은 남기고 목록으로 낸다', async () => {
  const dir = await makeInstalledRepo(['--lock-baselines'])
  const kitDir = join(dir, 'scripts/lanekit')
  appendFileSync(join(kitDir, 'gate.mjs'), '\n// 프로젝트가 고친 줄\n')
  appendFileSync(join(kitDir, 'lib/report.mjs'), '\n// 프로젝트가 고친 줄\n')
  const baselineBefore = read(kitDir, 'baselines/guidance.json')
  const configBefore = read(dir, 'lanekit.config.json')
  const pluginRoot = makeNewPlugin()

  const { code, output } = await runUpdate(dir, ['--yes'], pluginRoot)
  assert.equal(code, 0)
  assert.match(output, /프로젝트가 고쳐서 바꾸지 않는 파일 2개\n {2}gate\.mjs\n {2}lib\/report\.mjs/)
  assert.match(read(kitDir, 'gate.mjs'), /프로젝트가 고친 줄/)
  assert.match(read(kitDir, 'lib/report.mjs'), /프로젝트가 고친 줄/, '고친 파일은 그대로다')
  assert.match(read(dir, '.lanekit/update-suggestions/lib/report.mjs'), /changed upstream/, '새 원본은 제안 폴더에 둔다')
  assert.equal(read(kitDir, 'lib/added.mjs'), 'export const added = true\n')
  assert.ok(!existsSync(join(kitDir, 'lib/markdown.mjs')), '원본 그대로인데 새 버전에서 빠진 파일은 지운다')
  assert.equal(read(kitDir, 'baselines/guidance.json'), baselineBefore, '기준선은 건드리지 않는다')
  assert.equal(read(dir, 'lanekit.config.json'), configBefore)

  assert.equal(readLock(kitDir).version, NEW_VERSION)
  const compared = compareWithLock(kitDir)
  assert.deepEqual(compared.modified.sort(), ['gate.mjs', 'lib/report.mjs'], '고친 파일은 갱신 뒤에도 「고침」으로 남는다')
  assert.deepEqual(compared.missing, [])
})

test('--force 로 지정한 고친 파일은 새 원본으로 덮어쓴다', async () => {
  const dir = await makeInstalledRepo()
  const kitDir = join(dir, 'scripts/lanekit')
  appendFileSync(join(kitDir, 'lib/report.mjs'), '\n// 프로젝트가 고친 줄\n')
  const pluginRoot = makeNewPlugin()
  const { output } = await runUpdate(dir, ['--yes', '--force', 'lib/report.mjs'], pluginRoot)
  assert.match(output, /--force 로 덮어쓰는 파일 1개/)
  assert.equal(read(kitDir, 'lib/report.mjs'), read(pluginRoot, 'kit/lib/report.mjs'))
  assert.deepEqual(compareWithLock(kitDir).modified, [])
})

test('복사본에서 빠진 파일은 다시 놓고, 실행 권한을 지킨다', async () => {
  const dir = await makeInstalledRepo()
  const kitDir = join(dir, 'scripts/lanekit')
  rmSync(join(kitDir, 'git-hooks/pre-push'))
  const { output } = await runCommandModule(update, { cwd: dir, argv: ['--yes'] })
  assert.match(output, /빠져 있어서 다시 놓는 파일 1개/)
  assert.deepEqual(compareWithLock(kitDir).missing, [])
  assert.match(read(kitDir, 'git-hooks/pre-push'), /gate\.mjs/)
})

test('새 버전에서 빠졌는데 프로젝트가 고친 파일은 남긴다', async () => {
  const dir = await makeInstalledRepo()
  const kitDir = join(dir, 'scripts/lanekit')
  appendFileSync(join(kitDir, 'lib/markdown.mjs'), '\n// 프로젝트가 고친 줄\n')
  const { output } = await runUpdate(dir, ['--yes'], makeNewPlugin())
  assert.match(output, /프로젝트가 고쳐서 남기는 파일 1개\n {2}lib\/markdown\.mjs/)
  assert.ok(existsSync(join(kitDir, 'lib/markdown.mjs')))
  assert.deepEqual(compareWithLock(kitDir).extra, ['lib/markdown.mjs'], '잠금 파일에서는 빠진다')
})

test('복사본의 파일이 저장소 밖을 가리키는 심볼릭 링크면 아무것도 바꾸지 않고 종료 코드 2 다', async () => {
  const dir = await makeInstalledRepo()
  const kitDir = join(dir, 'scripts/lanekit')
  const outside = makeTempDir()
  copyFileSync(join(kitDir, 'lib/report.mjs'), join(outside, 'report.mjs'))
  rmSync(join(kitDir, 'lib/report.mjs'))
  symlinkSync(join(outside, 'report.mjs'), join(kitDir, 'lib/report.mjs'))
  const before = read(outside, 'report.mjs')
  const lockBefore = read(kitDir, 'lanekit.lock.json')

  const { code, output } = await runUpdate(dir, ['--yes'], makeNewPlugin())
  assert.equal(code, 2)
  assert.match(output, /쓰지 않는다: scripts\/lanekit\/lib\/report\.mjs/)
  assert.equal(read(outside, 'report.mjs'), before, '링크가 가리키는 저장소 밖 파일은 그대로다')
  assert.equal(read(kitDir, 'lanekit.lock.json'), lockBefore, '막힌 경로가 있으면 잠금 파일도 바꾸지 않는다')
  assert.ok(!existsSync(join(kitDir, 'lib/added.mjs')))
})

test('제안 폴더가 저장소 밖을 가리키면 고친 파일의 새 원본을 그곳에 두지 않는다', async () => {
  const dir = await makeInstalledRepo()
  const outside = makeTempDir()
  rmSync(join(dir, '.lanekit'), { recursive: true, force: true })
  symlinkSync(outside, join(dir, '.lanekit'), 'dir')
  appendFileSync(join(dir, 'scripts/lanekit/lib/report.mjs'), '\n// 프로젝트가 고친 줄\n')
  const { code, output } = await runUpdate(dir, ['--yes'], makeNewPlugin())
  assert.equal(code, 2)
  assert.match(output, /쓰지 않는다: \.lanekit\/update-suggestions\/lib\/report\.mjs/)
  assert.ok(!existsSync(join(outside, 'update-suggestions')))
})

test('모르는 플래그는 종료 코드 2 다', async () => {
  const dir = await makeInstalledRepo()
  assert.equal((await runCommandModule(update, { cwd: dir, argv: ['--all'] })).code, 2)
})
