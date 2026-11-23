// 플랫폼 차이 테스트 — 플랫폼 이름을 win32 로 넘겨, 이 머신에서 Windows 의 경로 · 줄바꿈 · 셸 인용 · 설정 폴더 · 훅 판정을 본다.
// 대상: kit/lib/platform.mjs 와 그것을 쓰는 순수 판정(tests 검사의 planCommand, doctor G3 의 judgeHook, 잠금 해시).
// 먼저 읽을 파일: ../kit/lib/platform.mjs.
import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { parseDenylist } from '../kit/checks/exposure/denylist.mjs'
import { scanTextForSecrets } from '../kit/checks/security/secret-rules.mjs'
import { planCommand } from '../kit/checks/tests/run.mjs'
import { findExecutable, resolveCommand } from '../kit/lib/exec.mjs'
import { parseAddedLines } from '../kit/lib/history.mjs'
import { headings } from '../kit/lib/markdown.mjs'
import {
  isEntryScript,
  isInsideDir,
  isSamePath,
  pathListSeparator,
  planSpawn,
  quoteShellArg,
  shouldRetryRename,
  splitLines,
  toLfBytes,
  toPosixPath,
  userConfigDir,
} from '../kit/lib/platform.mjs'
import { judgeHook } from '../lib/doctor-checks/g3-push-hook.mjs'
import { denylistPath } from '../lib/doctor-checks/e1-denylist.mjs'
import { planGitignore, planInit } from '../lib/init-plan.mjs'
import { hashContent } from '../lib/lock.mjs'
import { makeTempDir, writeFiles } from './helpers.mjs'

const WIN = 'win32'
const LINUX = 'linux'
const MAC = 'darwin'

test('경로: Windows 는 대소문자와 구분자를 가리지 않고 같은 경로로 본다', () => {
  assert.equal(isSamePath('C:\\Repo\\scripts\\gate.mjs', 'c:/repo/scripts/gate.mjs', WIN), true)
  assert.equal(isSamePath('C:\\repo\\a\\..\\gate.mjs', 'C:\\repo\\gate.mjs', WIN), true)
  assert.equal(isSamePath('C:\\repo\\gate.mjs', 'D:\\repo\\gate.mjs', WIN), false)
  assert.equal(isSamePath('/repo/Gate.mjs', '/repo/gate.mjs', LINUX), false, '그 밖의 플랫폼은 글자 그대로 견준다')
  assert.equal(isSamePath('/repo/a/../gate.mjs', '/repo/gate.mjs', MAC), true)
})

test('경로: 폴더 안인지의 판정은 Windows 에서 대소문자를 가리지 않고, 다른 드라이브는 밖이다', () => {
  assert.equal(isInsideDir('C:\\Repo', 'c:\\repo\\docs', WIN), true)
  assert.equal(isInsideDir('C:\\Repo', 'C:\\Repo', WIN), true, '폴더 자신')
  assert.equal(isInsideDir('C:\\Repo', 'C:\\Repo-other\\docs', WIN), false, '이름이 같은 글자로 시작하는 옆 폴더')
  assert.equal(isInsideDir('C:\\Repo', 'C:\\', WIN), false)
  assert.equal(isInsideDir('C:\\Repo', 'D:\\Repo\\docs', WIN), false)
  assert.equal(isInsideDir('C:\\Repo', '\\\\server\\share\\Repo', WIN), false, '네트워크 경로')
  assert.equal(isInsideDir('/repo', '/repo/docs/a', LINUX), true)
  assert.equal(isInsideDir('/repo', '/repo', LINUX), true)
  assert.equal(isInsideDir('/repo', '/repo-other', LINUX), false)
  assert.equal(isInsideDir('/repo', '/Repo/docs', LINUX), false)
  assert.equal(isInsideDir('/repo', '/repo/..hidden', LINUX), true, '`..` 으로 시작하는 이름의 파일은 안이다')
})

test('경로: 출력과 증거에 쓰는 경로는 Windows 에서도 `/` 로 나눈다', () => {
  assert.equal(toPosixPath('.lanekit\\evidence\\abc-light.json', WIN), '.lanekit/evidence/abc-light.json')
  assert.equal(toPosixPath('back\\slash.txt', LINUX), 'back\\slash.txt', '그 밖의 플랫폼에서 역슬래시는 이름의 글자다')
})

test('진입 판정: 직접 불린 스크립트만 참이고, 없는 경로와 빈 인자는 거짓이다', () => {
  // Node 는 모듈 주소를 실제 경로로 만든다. 임시 폴더가 링크 아래에 있는 머신(macOS)에서도 같게 하려고 실제 경로로 주소를 만든다.
  const dir = makeTempDir()
  writeFiles(dir, { 'gate.mjs': '', 'other.mjs': '' })
  const moduleUrl = pathToFileURL(join(realpathSync(dir), 'gate.mjs')).href
  assert.equal(isEntryScript(join(dir, 'gate.mjs'), moduleUrl), true)
  assert.equal(isEntryScript(join(dir, 'other.mjs'), moduleUrl), false)
  assert.equal(isEntryScript(join(dir, 'missing.mjs'), moduleUrl), false)
  assert.equal(isEntryScript(undefined, moduleUrl), false)
})

test('줄바꿈: CRLF 로 저장된 글도 줄 끝에 CR 이 남지 않는다', () => {
  assert.deepEqual(splitLines('a\r\nb\nc\r\n'), ['a', 'b', 'c', ''])
  assert.deepEqual(splitLines('a\nb'), ['a', 'b'])
  assert.deepEqual(splitLines('a\rb'), ['a\rb'], '혼자 있는 CR 은 줄바꿈이 아니다')
})

test('줄바꿈: CRLF 파일에서도 `$` 로 끝을 보는 금지어 · 제목 · 이력의 더해진 줄이 맞는다', () => {
  const { rules, invalidLines } = parseDenylist('# 목록\r\nacme-internal$\r\n')
  assert.deepEqual([rules.map((rule) => rule.number), invalidLines], [[2], []])
  assert.deepEqual(headings('# 제목\r\n\r\n본문\r\n'), [{ line: 1, title: '제목' }])
  const added = parseAddedLines('lanekit-commit abc\r\ndiff --git a/a.txt b/a.txt\n+++ b/a.txt\n@@ -0,0 +1 @@\n+value\r\n')
  assert.deepEqual(added.map((entry) => [entry.file, entry.text]), [['a.txt', 'value']])
  const token = ['gh', 'p_', 'a'.repeat(36)].join('')
  assert.deepEqual(scanTextForSecrets(`clean\r\n${token}\r\n`).map((found) => found.line), [2])
})

test('줄바꿈: 해시는 CRLF 와 LF 를 같은 내용으로 보고, 다른 바이트는 그대로 둔다', () => {
  assert.deepEqual([...toLfBytes(Buffer.from('a\r\nb\r\n'))], [...Buffer.from('a\nb\n')])
  assert.deepEqual([...toLfBytes(Buffer.from('a\rb\n\r'))], [...Buffer.from('a\rb\n\r')], '혼자 있는 CR 은 지우지 않는다')
  const unchanged = Buffer.from('a\nb\n')
  assert.equal(toLfBytes(unchanged), unchanged, 'CR 이 없으면 받은 것을 그대로 돌려준다')
  assert.equal(hashContent(Buffer.from('export const a = 1\r\n')), hashContent(Buffer.from('export const a = 1\n')))
  assert.notEqual(hashContent(Buffer.from('export const a = 2\n')), hashContent(Buffer.from('export const a = 1\n')))
})

test('줄바꿈: init 은 CRLF 로 체크아웃된 같은 파일을 그대로 두고, CRLF 인 .gitignore 의 줄도 알아본다', () => {
  const target = { path: 'AGENTS.md', content: Buffer.from('# 지침\n본문\n'), group: 'template' }
  assert.equal(planInit([target], { 'AGENTS.md': Buffer.from('# 지침\r\n본문\r\n') })[0].action, 'keep')
  assert.equal(planInit([target], { 'AGENTS.md': Buffer.from('# 다른 지침\r\n') })[0].action, 'suggest')
  assert.equal(planGitignore('.lanekit/\r\n.env\r\n', false).action, 'keep')
})

test('셸 인용: cmd.exe 는 큰따옴표로 감싸고 % 는 따옴표 밖에서 ^% 로 적는다', () => {
  assert.equal(quoteShellArg('a.mjs', WIN), '"a.mjs"')
  assert.equal(quoteShellArg('new file.mjs', WIN), '"new file.mjs"')
  assert.equal(quoteShellArg('a&b|c<d>e^f.mjs', WIN), '"a&b|c<d>e^f.mjs"', '큰따옴표 안의 연산 글자는 글자 그대로다')
  assert.equal(quoteShellArg('100%PATH%.txt', WIN), '"100"^%"PATH"^%".txt"')
  assert.equal(quoteShellArg('C:\\dir\\', WIN), '"C:\\dir\\\\"', '끝의 역슬래시는 두 배로 적는다')
  assert.equal(quoteShellArg("it's.mjs", WIN), '"it\'s.mjs"')
  assert.equal(quoteShellArg('', WIN), '""')
  assert.equal(quoteShellArg("it's.mjs", LINUX), "'it'\\''s.mjs'")
  assert.equal(quoteShellArg('$HOME `x`.mjs', MAC), "'$HOME `x`.mjs'")
})

test('셸 인용: tests 검사는 플랫폼의 셸에 맞게 파일 이름을 감싼다', () => {
  const options = { full: 'run-all', changed: 'run-some {files}' }
  const existingChangedFiles = ['a.mjs', 'new file.mjs']
  assert.deepEqual(planCommand({ profile: 'changed', options, existingChangedFiles, platform: WIN }), { command: 'run-some "a.mjs" "new file.mjs"' })
  assert.deepEqual(planCommand({ profile: 'changed', options, existingChangedFiles, platform: LINUX }), { command: "run-some 'a.mjs' 'new file.mjs'" })
})

test('실행: Windows 의 배치 파일만 셸을 거치고, 경로와 인자를 모두 감싼다', () => {
  const npm = 'C:\\Program Files\\nodejs\\npm.cmd'
  assert.deepEqual(planSpawn(npm, ['audit', '--omit=dev', '--json'], WIN), {
    command: '"C:\\Program Files\\nodejs\\npm.cmd" "audit" "--omit=dev" "--json"',
    args: [],
    shell: true,
  })
  const report = 'C:\\Users\\First Last\\AppData\\Local\\Temp\\report.json'
  assert.equal(planSpawn('C:\\tools\\gitleaks.BAT', ['--report-path', report], WIN).command, `"C:\\tools\\gitleaks.BAT" "--report-path" "${report}"`)
  assert.deepEqual(planSpawn('C:\\tools\\gitleaks.exe', ['--report-path', report], WIN), { command: 'C:\\tools\\gitleaks.exe', args: ['--report-path', report], shell: false })
  assert.deepEqual(planSpawn('/usr/local/bin/npm', ['audit'], LINUX), { command: '/usr/local/bin/npm', args: ['audit'], shell: false })
  assert.deepEqual(planSpawn('/tmp/tool.cmd', [], MAC), { command: '/tmp/tool.cmd', args: [], shell: false }, '그 밖의 플랫폼에서는 확장자를 보지 않는다')
})

test('실행: PATH 는 플랫폼의 구분 글자로 나누고, Windows 는 이름만 받은 명령을 찾은 파일로 바꾼다', () => {
  assert.deepEqual([pathListSeparator(WIN), pathListSeparator(LINUX), pathListSeparator(MAC)], [';', ':', ':'])
  const dir = makeTempDir()
  writeFiles(dir, { 'claude.cmd': '@echo off\r\n', claude: '#!/bin/sh\n' })
  const env = { Path: `C:\\nowhere;${dir}`, PATHEXT: '.EXE;.CMD' }
  assert.equal(findExecutable('claude', env, WIN), join(dir, 'claude.cmd'))
  assert.equal(resolveCommand('claude', env, WIN), join(dir, 'claude.cmd'))
  assert.equal(resolveCommand('absent-tool', env, WIN), 'absent-tool', '찾지 못하면 받은 이름 그대로')
  assert.equal(resolveCommand('C:\\tools\\node.exe', env, WIN), 'C:\\tools\\node.exe', '경로로 받은 명령은 찾지 않는다')
  assert.equal(resolveCommand('claude', { PATH: dir }, LINUX), 'claude', '그 밖의 플랫폼은 바꾸지 않는다')
})

test('설정 폴더: Windows 는 %APPDATA%\\lanekit, 그 밖에는 ~/.config/lanekit 이다', () => {
  const roaming = 'C:\\Users\\dev\\AppData\\Roaming'
  assert.equal(userConfigDir({ env: { APPDATA: roaming }, home: 'C:\\Users\\dev', platform: WIN }), `${roaming}\\lanekit`)
  assert.equal(userConfigDir({ env: {}, home: 'C:\\Users\\dev', platform: WIN }), `${roaming}\\lanekit`, 'APPDATA 가 없으면 홈 폴더 아래의 기본 자리')
  assert.equal(userConfigDir({ env: { APPDATA: roaming }, home: '/home/dev', platform: LINUX }), '/home/dev/.config/lanekit')
  assert.equal(userConfigDir({ env: {}, home: '/Users/dev', platform: MAC }), '/Users/dev/.config/lanekit')
  const machine = { home: 'C:\\Users\\dev', env: { APPDATA: roaming }, platform: WIN }
  assert.ok(denylistPath(machine).startsWith(`${roaming}\\lanekit`))
  assert.equal(denylistPath({ ...machine, env: { LANEKIT_DENYLIST: 'D:\\lists\\deny.txt' } }), 'D:\\lists\\deny.txt', '환경 변수가 먼저다')
})

test('이름 바꾸기: Windows 에서 파일이 잠깐 잡혀 있는 실패만 다섯 번까지 다시 한다', () => {
  assert.equal(shouldRetryRename('EPERM', 0, WIN), true)
  assert.equal(shouldRetryRename('EBUSY', 4, WIN), true)
  assert.equal(shouldRetryRename('EACCES', 5, WIN), false, '다섯 번 실패한 뒤에는 그만둔다')
  assert.equal(shouldRetryRename('ENOENT', 0, WIN), false)
  assert.equal(shouldRetryRename('EPERM', 0, LINUX), false)
  assert.equal(shouldRetryRename('EBUSY', 0, MAC), false)
})

test('G3: Windows 는 권한 비트 대신 git 에 올라간 권한과 줄바꿈을 본다', () => {
  const lf = '#!/bin/sh\nexec node gate.mjs\n'
  const staged = (mode) => `${mode} 0123456789abcdef0123456789abcdef01234567 0\t.githooks/pre-push`
  assert.equal(judgeHook({ content: lf, mode: 0o100666, indexEntry: '' }, WIN), 'ok', '아직 git 에 올리지 않은 훅')
  assert.equal(judgeHook({ content: lf, mode: 0o100666, indexEntry: staged('100755') }, WIN), 'ok')
  assert.equal(judgeHook({ content: lf, mode: 0o100666, indexEntry: staged('100644') }, WIN), 'index-not-executable')
  assert.equal(judgeHook({ content: lf.replaceAll('\n', '\r\n'), mode: 0o100666, indexEntry: staged('100755') }, WIN), 'crlf')
  assert.equal(judgeHook({ content: null, mode: 0, indexEntry: '' }, WIN), 'missing')
  assert.equal(judgeHook({ content: lf, mode: 0o100644, indexEntry: staged('100644') }, LINUX), 'not-executable')
  assert.equal(judgeHook({ content: lf, mode: 0o100755, indexEntry: staged('100644') }, MAC), 'ok', '그 밖의 플랫폼은 파일의 권한 비트만 본다')
  assert.equal(judgeHook({ content: lf.replaceAll('\n', '\r\n'), mode: 0o100755, indexEntry: '' }, LINUX), 'crlf')
})
