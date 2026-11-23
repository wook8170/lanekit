// 통합 테스트 도우미 — 빈 저장소에 init 을 돌리고, 복사된 게이트로 「잠금 → 위반 → 래칫 실패 → 재잠금 → full」 을 차례로 확인한다.
// 부르는 곳: tests/e2e-plain.test.mjs · e2e-ts.test.mjs · e2e-ts-fastify.test.mjs.
// 먼저 읽을 파일: scaffold-helpers.mjs(격리된 머신과 하위 명령 실행), ../kit/README.md(모드와 재잠금).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import * as init from '../lib/init.mjs'
import { git, readJson, writeFiles } from './helpers.mjs'
import { makeMachine, makeRepo, REPO_ROOT, runCommandModule } from './scaffold-helpers.mjs'

const GATE_SCRIPT = 'scripts/lanekit/gate.mjs'
const PASSING_TESTS = 'node -e "process.exit(0)"'
const DECISION = '0001-allow-growth'
const SHORT_COMMIT = 12
const IGNORED = 'node_modules/\n.lanekit/\n.env\n'

/** 프로젝트가 typescript 를 설치한 것처럼, lanekit 저장소의 typescript 를 node_modules 에 잇는다. 링크 종류(junction)는 Windows 에서만 쓰인다. 권한 없이 만들 수 있는 폴더 링크다. */
function linkTypescript(dir) {
  mkdirSync(join(dir, 'node_modules'), { recursive: true })
  symlinkSync(join(REPO_ROOT, 'node_modules', 'typescript'), join(dir, 'node_modules', 'typescript'), 'junction')
}

/**
 * 빈 저장소에 files 를 놓고 init 을 돌린다. 레인키퍼 · wook-skills · gitleaks 가 없는 머신이다.
 * bin 에 { 명령 이름: 셸 스크립트 본문 } 을 주면 그 명령이 있는 머신이 된다.
 * 돌려주는 값은 { dir, machine, applied } 이고 applied 는 init 의 { code, output } 이다.
 */
export async function scaffoldProject({ files = {}, modules = [], bin = {} } = {}) {
  const machine = makeMachine({ bin })
  const dir = makeRepo({ '.gitignore': IGNORED, ...files })
  if (modules.length > 0) linkTypescript(dir)
  const argv = ['--yes', '--modules', modules.join(',') || 'none', '--test-full', PASSING_TESTS, '--lock-baselines']
  const applied = await runCommandModule(init, { cwd: dir, machine, argv })
  return { dir, machine, applied }
}

/** 프로젝트로 복사된 게이트를 돌려 { code, output } 을 돌려준다. */
export function runCopiedGate({ dir, machine }, argv) {
  const spawned = spawnSync(process.execPath, [GATE_SCRIPT, ...argv], { cwd: dir, env: machine.env, encoding: 'utf8' })
  return { code: spawned.status, output: `${spawned.stdout}${spawned.stderr}` }
}

export function commitAll(dir, message) {
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', message)
  return git(dir, 'rev-parse', 'HEAD')
}

function setMode(dir, checkId, mode) {
  const file = join(dir, 'lanekit.config.json')
  const config = readJson(file)
  config.checks[checkId] = { ...config.checks[checkId], mode }
  writeFiles(dir, { 'lanekit.config.json': config })
}

const baselineOf = (dir, checkId) => readJson(join(dir, 'scripts/lanekit/baselines', `${checkId}.json`)).values

/**
 * 놓은 날부터 출하 게이트까지의 흐름을 확인한다.
 * checkId 는 래칫으로 올릴 검사, violate(dir) 는 그 검사의 값을 늘리는 변경, grownRule 은 늘어날 규칙이다.
 */
export function assertRatchetJourney(project, { checkId, violate, grownRule }) {
  const { dir, applied } = project
  const gateOf = (...argv) => runCopiedGate(project, argv)
  const relock = (...extra) => gateOf('--relock', checkId, '--reason', '통합 테스트', ...extra)

  assert.equal(applied.code, 0)
  assert.match(applied.output, /게이트 종료 코드: 0/, '놓은 날의 light 게이트는 막히지 않는다')
  assert.ok(existsSync(join(dir, 'scripts/lanekit/baselines', `${checkId}.json`)), `${checkId} 의 기준선을 잠갔다`)
  commitAll(dir, 'chore: lanekit init')
  assert.equal(gateOf('--profile', 'light').code, 0, '커밋한 뒤의 light 게이트')

  setMode(dir, checkId, 'ratchet')
  const locked = gateOf('--profile', 'light')
  assert.equal(locked.code, 0, `잠근 값 그대로면 ratchet 을 통과한다\n${locked.output}`)

  const before = baselineOf(dir, checkId)
  violate(dir)
  const grown = gateOf('--profile', 'light')
  assert.equal(grown.code, 1, `값이 늘면 ratchet 이 실패한다\n${grown.output}`)
  assert.match(grown.output, new RegExp(`✗ ${checkId}\\s+ratchet`))
  assert.match(grown.output, new RegExp(`\\+ \\[${grownRule}\\]`))

  assert.equal(relock().code, 1, '늘어난 값은 결정 ID 없이 재잠금할 수 없다')
  assert.equal(relock('--allow-increase', '--decision', DECISION).code, 1, '결정 파일이 없으면 거절한다')
  assert.deepEqual(baselineOf(dir, checkId), before, '거절된 재잠금은 기준선을 바꾸지 않는다')
  writeFiles(dir, { [`docs/decisions/${DECISION}.md`]: '# 늘어난 값을 받아들인다\n' })
  assert.equal(relock('--allow-increase', '--decision', DECISION).code, 0)
  assert.notDeepEqual(baselineOf(dir, checkId), before)
  assert.equal(gateOf('--profile', 'light').code, 0, '재잠금한 뒤에는 통과한다')

  const commit = commitAll(dir, 'feat: accepted growth')
  const full = gateOf('--profile', 'full')
  assert.equal(full.code, 0, `출하 게이트\n${full.output}`)
  const evidence = readJson(join(dir, '.lanekit/evidence', `${commit.slice(0, SHORT_COMMIT)}-full.json`))
  assert.deepEqual([evidence.commit, evidence.dirty, evidence.partial, evidence.failed], [commit, false, false, []])
  assert.ok(evidence.checks.some((check) => check.id === 'tests' && check.verdict === 'pass'), 'full 프로필에서 테스트가 돌았다')
}
