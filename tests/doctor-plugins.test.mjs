// doctor 테스트(P · I4 · E1 · S) — 개인 설정 폴더와 머신에 깔린 도구를 보는 항목의 정상 사례와 문제 사례를 본다.
// 대상: lib/doctor-checks/ 의 p1 ~ p4 · i4 · e1 · s1 · s2, lib/claude-home.mjs.
// 먼저 읽을 파일: ../lib/claude-home.mjs.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { compareVersions, memoryIndexPath, readPluginState } from '../lib/claude-home.mjs'
import * as e1 from '../lib/doctor-checks/e1-denylist.mjs'
import * as i4 from '../lib/doctor-checks/i4-memory-index.mjs'
import * as p1 from '../lib/doctor-checks/p1-plugins-installed.mjs'
import * as p2 from '../lib/doctor-checks/p2-plugin-versions.mjs'
import * as p3 from '../lib/doctor-checks/p3-personal-hooks.mjs'
import * as p4 from '../lib/doctor-checks/p4-machine-limits.mjs'
import * as s1 from '../lib/doctor-checks/s1-gitleaks.mjs'
import * as s2 from '../lib/doctor-checks/s2-env-ignored.mjs'
import { IS_WINDOWS, makeProject, makeTempDir, writeFiles } from './helpers.mjs'
import { makeMachine, pluginHome, runDoctorCheck } from './scaffold-helpers.mjs'

// 격리된 머신에는 APPDATA 가 없다. 그래서 Windows 의 설정 폴더는 홈 폴더 아래의 기본 자리다.
const DENYLIST_IN_HOME = IS_WINDOWS ? 'AppData/Roaming/lanekit/denylist.txt' : '.config/lanekit/denylist.txt'

const CURRENT = { lanekeeper: '0.2.7', 'wook-skills': '0.1.2' }
const statusOf = (checkModule, root, machine) => runDoctorCheck(checkModule, root, machine).status

test('P1: 두 플러그인이 설치되고 켜져 있으면 ok, 없거나 꺼져 있으면 fail 이다', () => {
  const root = makeTempDir()
  assert.equal(statusOf(p1, root, makeMachine({ home: pluginHome(CURRENT) })), 'ok')
  const absent = runDoctorCheck(p1, root, makeMachine({ home: pluginHome({ lanekeeper: '0.2.7' }) }))
  assert.equal(absent.status, 'fail')
  assert.match(absent.message, /wook-skills/)
  assert.match(absent.fix, /\/plugin install <이름>@<마켓플레이스>.*대상: wook-skills/)
  const disabled = runDoctorCheck(p1, root, makeMachine({ home: pluginHome(CURRENT, ['lanekeeper']) }))
  assert.equal(disabled.status, 'fail')
  assert.match(disabled.message, /lanekeeper/)
  assert.equal(statusOf(p1, root, makeMachine()), 'fail', '설치 기록이 없는 머신')
})

test('P1: 설정 폴더를 CLAUDE_CONFIG_DIR 로 옮긴 머신에서도 설치 기록을 찾는다', () => {
  const moved = Object.fromEntries(Object.entries(pluginHome(CURRENT)).map(([path, content]) => [path.replace('.claude/', 'profile/'), content]))
  const machine = makeMachine({ home: moved })
  machine.env.CLAUDE_CONFIG_DIR = join(machine.home, 'profile')
  assert.equal(statusOf(p1, makeTempDir(), machine), 'ok')
  assert.deepEqual(readPluginState(machine, 'lanekeeper'), { installed: true, enabled: true, version: '0.2.7' })
})

test('P2: 최소 버전보다 낮으면 warn 이고, 설치 기록이 없으면 건너뛴다', () => {
  const root = makeTempDir()
  assert.equal(statusOf(p2, root, makeMachine({ home: pluginHome({ lanekeeper: '0.3.0', 'wook-skills': '0.1.2' }) })), 'ok')
  const outdated = runDoctorCheck(p2, root, makeMachine({ home: pluginHome({ lanekeeper: '0.2.6', 'wook-skills': '0.1.10' }) }))
  assert.equal(outdated.status, 'warn')
  assert.match(outdated.message, /lanekeeper 0\.2\.6 < 0\.2\.7/)
  assert.ok(!/wook-skills/.test(outdated.message), '0.1.10 은 0.1.2 보다 높다')
  assert.equal(statusOf(p2, root, makeMachine()), 'skip')
})

test('버전은 자리마다 수로 견준다', () => {
  assert.ok(compareVersions('0.1.10', '0.1.2') > 0)
  assert.ok(compareVersions('0.2.6', '0.2.7') < 0)
  assert.equal(compareVersions('1.0', '1.0.0'), 0)
})

test('P3: 개인 설정의 훅에 세션 가드가 남아 있으면 warn 이다', () => {
  const root = makeTempDir()
  const hooksOf = (command) => ({ '.claude/settings.json': { hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command }] }] } } })
  assert.equal(statusOf(p3, root, makeMachine({ home: hooksOf('echo done') })), 'ok')
  assert.equal(statusOf(p3, root, makeMachine()), 'ok', '설정 파일이 없는 머신')
  const duplicated = runDoctorCheck(p3, root, makeMachine({ home: hooksOf('sh ~/.claude/hooks/handoff-guard/stop.sh') }))
  assert.equal(duplicated.status, 'warn')
  assert.match(duplicated.message, /handoff-guard/)
  assert.ok(!/auto-retry/.test(duplicated.message))
})

test('P4: 레인키퍼의 machine.json 이 없으면 warn 이다', () => {
  const root = makeTempDir()
  assert.equal(statusOf(p4, root, makeMachine({ home: { '.lanekeeper/machine.json': { version: 1 } } })), 'ok')
  const absent = runDoctorCheck(p4, root, makeMachine())
  assert.equal(absent.status, 'warn')
  assert.match(absent.message, /레인 3/)
})

test('I4: 메모리 색인이 150줄이나 20 KB 를 넘으면 warn 이고, 찾지 못하면 건너뛴다', () => {
  const root = makeTempDir()
  const indexOf = (machine) => memoryIndexPath(machine, root).slice(machine.home.length + 1)
  const withIndex = (content) => {
    const machine = makeMachine()
    writeFiles(machine.home, { [indexOf(machine)]: content })
    return machine
  }
  assert.equal(statusOf(i4, root, makeMachine()), 'skip')
  assert.equal(statusOf(i4, root, withIndex('- 항목\n'.repeat(150))), 'ok')
  const tooLong = runDoctorCheck(i4, root, withIndex('- 항목\n'.repeat(151)))
  assert.equal(tooLong.status, 'warn')
  assert.match(tooLong.message, /151줄/)
  assert.equal(statusOf(i4, root, withIndex(`${'가'.repeat(7000)}\n`)), 'warn', '한 줄이어도 20 KB 를 넘으면 경고다')
})

test('메모리 폴더 이름은 저장소 경로의 글자 · 숫자가 아닌 자리를 - 로 바꾼 것이다', () => {
  // 폴더를 잇는 글자는 플랫폼의 것이다. 보려는 것은 저장소 경로에서 만든 폴더 이름이다.
  const machine = { home: join('home', 'dev'), env: {} }
  assert.equal(memoryIndexPath(machine, '/work/acme_app.v2'), join('home', 'dev', '.claude', 'projects', '-work-acme-app-v2', 'memory', 'MEMORY.md'))
  assert.equal(memoryIndexPath(machine, 'C:\\work\\acme app'), join('home', 'dev', '.claude', 'projects', 'C--work-acme-app', 'memory', 'MEMORY.md'), 'Windows 의 저장소 경로')
})

test('E1: 공개 저장소인데 금지어 목록이 없으면 fail 이다', () => {
  const publicRepo = makeProject({ repo: { visibility: 'public' } })
  assert.equal(statusOf(e1, makeProject({}), makeMachine()), 'ok', '비공개 저장소는 보지 않는다')
  const absent = runDoctorCheck(e1, publicRepo, makeMachine())
  assert.equal(absent.status, 'fail')
  assert.match(absent.fix, /LANEKIT_DENYLIST/)
  assert.equal(statusOf(e1, publicRepo, makeMachine({ home: { [DENYLIST_IN_HOME]: 'secret-name\n' } })), 'ok')
  const elsewhere = makeMachine({ home: { 'lists/deny.txt': 'secret-name\n' } })
  elsewhere.env.LANEKIT_DENYLIST = join(elsewhere.home, 'lists/deny.txt')
  assert.equal(statusOf(e1, publicRepo, elsewhere), 'ok', '환경 변수로 준 경로를 먼저 본다')
})

test('S1: gitleaks 가 있으면 ok, 없으면 warn 이다', () => {
  const root = makeTempDir()
  assert.equal(statusOf(s1, root, makeMachine({ bin: { gitleaks: 'echo 8.0.0' } })), 'ok')
  const absent = runDoctorCheck(s1, root, makeMachine())
  assert.equal(absent.status, 'warn')
  assert.match(absent.message, /내장 규칙 6종/)
})

test('S2: .gitignore 에 .env 가 없으면 warn 이다', () => {
  const machine = makeMachine()
  assert.equal(statusOf(s2, makeProject({}, { '.gitignore': 'node_modules/\n.env\n' }), machine), 'ok')
  assert.equal(statusOf(s2, makeProject({}, { '.gitignore': '.env*\n' }), machine), 'ok')
  assert.equal(statusOf(s2, makeProject({}, { '.gitignore': '.envrc\nenv/\n' }), machine), 'warn')
  assert.equal(statusOf(s2, makeTempDir(), machine), 'warn', '.gitignore 가 없는 저장소')
})
