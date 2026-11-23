// 끝에서 끝까지 테스트 — 빈 저장소에 init 을 돌리고, 커밋 · 게이트 · doctor · 복사본 고치기 · update 까지 한 흐름으로 확인한다.
// 대상: bin/lanekit 과 lib/ 의 init · doctor · update 전체. 플러그인 사본의 검사는 모두 실제 검사다.
// 먼저 읽을 파일: scaffold-helpers.mjs 의 makePluginRoot.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import * as doctor from '../lib/doctor.mjs'
import * as init from '../lib/init.mjs'
import { compareWithLock } from '../lib/lock.mjs'
import * as update from '../lib/update.mjs'
import { git } from './helpers.mjs'
import { FAKE_GITLEAKS, FAKE_LANEKEEPER, makeMachine, makePluginRoot, makeRepo, pluginHome, REPO_ROOT, runCommandModule, VERSION } from './scaffold-helpers.mjs'

const statusesOf = (output) => Object.fromEntries(JSON.parse(output).results.map((result) => [result.id, result.status]))

test('init → 커밋 → 게이트 → doctor → 복사본 고치기 → update', async () => {
  const pluginRoot = makePluginRoot({ stubChecks: true })
  const machine = makeMachine({
    bin: { 'lanekeeper-config': FAKE_LANEKEEPER, gitleaks: FAKE_GITLEAKS },
    home: { ...pluginHome({ lanekeeper: '0.2.7', 'wook-skills': '0.1.2' }), '.lanekeeper/machine.json': { version: 1 } },
  })
  const dir = makeRepo({ 'package.json': { name: 'acme-app', scripts: { test: 'node --test' } }, 'package-lock.json': '{}\n' })
  const session = { cwd: dir, machine, pluginRoot }

  const planned = await runCommandModule(init, { ...session, argv: [] })
  assert.match(planned.output, /전체 테스트 명령: npm test/)

  const applied = await runCommandModule(init, { ...session, argv: ['--yes', '--set-hooks-path', '--lock-baselines'] })
  assert.equal(applied.code, 0)
  assert.match(applied.output, /게이트 종료 코드: 0/, '놓은 날에는 게이트가 막히지 않는다')
  assert.match(applied.output, /결과: 실패 0/)
  assert.ok(existsSync(join(dir, 'scripts/lanekit/baselines/guidance.json')))

  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'chore: lanekit init')
  assert.equal(git(dir, 'status', '--porcelain'), '', '.lanekit/ 은 git 이 추적하지 않는다')

  const gateOutput = execFileSync(process.execPath, ['scripts/lanekit/gate.mjs', '--profile', 'light'], { cwd: dir, env: machine.env, encoding: 'utf8' })
  assert.match(gateOutput, /결과: 실패 0/)

  const healthy = await runCommandModule(doctor, { ...session, argv: ['--json'] })
  assert.equal(healthy.code, 0)
  const statuses = statusesOf(healthy.output)
  for (const id of ['P1', 'P2', 'P3', 'P4', 'K1', 'K2', 'K3', 'K4', 'K5', 'G1', 'G2', 'G3', 'G4', 'G5', 'I1', 'I2', 'I3', 'E1', 'S1', 'S2']) {
    assert.equal(statuses[id], 'ok', id)
  }
  assert.equal(statuses.W1, 'warn', '문서 폴더가 생겼는데 문서 검색은 아직 잇지 않았다')

  appendFileSync(join(dir, 'scripts/lanekit/lib/report.mjs'), '\n// 프로젝트가 고친 줄\n')
  const edited = await runCommandModule(doctor, { ...session, argv: [] })
  assert.match(edited.output, /! K2 .*lib\/report\.mjs/)

  const newPlugin = makePluginRoot({ stubChecks: true, edit: (root) => appendFileSync(join(root, 'kit/lib/profile.mjs'), '\n// changed upstream\n') })
  const outdated = await runCommandModule(doctor, { ...session, argv: ['--json'], pluginRoot: newPlugin, version: '9.9.9' })
  assert.equal(statusesOf(outdated.output).K3, 'warn')

  const updated = await runCommandModule(update, { cwd: dir, argv: ['--yes'], pluginRoot: newPlugin, version: '9.9.9' })
  assert.match(updated.output, /새 원본으로 바꾸는 파일 1개\n {2}lib\/profile\.mjs/)
  assert.match(updated.output, /프로젝트가 고쳐서 바꾸지 않는 파일 1개\n {2}lib\/report\.mjs/)
  assert.match(readFileSync(join(dir, 'scripts/lanekit/lib/profile.mjs'), 'utf8'), /changed upstream/)
  assert.match(readFileSync(join(dir, 'scripts/lanekit/lib/report.mjs'), 'utf8'), /프로젝트가 고친 줄/)
  assert.deepEqual(compareWithLock(join(dir, 'scripts/lanekit')).modified, ['lib/report.mjs'])

  const after = await runCommandModule(doctor, { ...session, argv: ['--json'], pluginRoot: newPlugin, version: '9.9.9' })
  assert.equal(statusesOf(after.output).K3, 'ok')
  assert.equal(statusesOf(after.output).K2, 'warn')
})

test('lanekit 명령으로 init · doctor · update 를 부를 수 있고 --lang 으로 언어를 고른다', () => {
  const machine = makeMachine()
  const dir = makeRepo()
  const lanekit = (...argv) => {
    try {
      return { code: 0, output: execFileSync(process.execPath, [join(REPO_ROOT, 'bin/lanekit'), ...argv], { cwd: dir, env: machine.env, encoding: 'utf8' }) }
    } catch (error) {
      if (typeof error.status !== 'number') throw error
      return { code: error.status, output: error.stdout }
    }
  }
  assert.match(lanekit('init', '--lang', 'en').output, /Nothing has been written yet/)
  assert.equal(lanekit('init', '--lang', 'en', '--yes').code, 0)
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /working guide/)
  const checked = lanekit('doctor')
  assert.equal(checked.code, 1, '플러그인이 없는 머신이라 P1 이 실패다')
  assert.match(checked.output, /lanekit doctor/, '설정의 언어(en)로 낸다')
  assert.match(lanekit('update').output, /Nothing to change/)
  assert.equal(lanekit('version').output.trim(), VERSION)
})
