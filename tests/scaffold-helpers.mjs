// init · doctor · update 테스트의 도우미 — 격리된 머신(홈 폴더 · PATH), 가짜 실행 파일, 플러그인 사본, 하위 명령 실행.
// 부르는 곳: tests/init-*.test.mjs · update.test.mjs · doctor-*.test.mjs · scaffold-e2e.test.mjs.
// 먼저 읽을 파일: helpers.mjs(임시 폴더와 git 도우미), ../lib/doctor-context.mjs(machine 의 모양).
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findExecutable } from '../kit/lib/exec.mjs'
import { defaultRegistry } from '../kit/lib/registry.mjs'
import { createDoctorContext } from '../lib/doctor-context.mjs'
import { listFiles } from '../lib/lock.mjs'
import { createCliTranslator } from '../lib/messages.mjs'
import { git, IS_WINDOWS, makeTempDir, writeFiles } from './helpers.mjs'

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const VERSION = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version
export const FIXED_NOW = new Date('2026-06-01T00:00:00Z')

// node 와 git 만 보이는 PATH. 이 머신에 깔린 레인키퍼 · gitleaks 가 테스트에 섞이지 않게 한다.
// Windows 에는 정해진 폴더가 없어서 git 과 sh(Git for Windows 에 들어 있다)가 깔린 폴더를 찾아 쓴다.
const dirOf = (command) => dirname(findExecutable(command) ?? '')
const BASIC_COMMAND_DIRS = IS_WINDOWS ? [...new Set([dirOf('git'), dirOf('sh')])].filter((dir) => dir !== '.') : ['/usr/bin', '/bin']
const BASE_PATH = [dirname(process.execPath), ...BASIC_COMMAND_DIRS].join(delimiter)

// Windows 의 프로그램은 이 변수들이 없으면 시작하지 못하거나 임시 폴더를 찾지 못한다. 격리된 환경에도 그대로 넘긴다.
const WINDOWS_SYSTEM_VARIABLES = ['SystemRoot', 'SystemDrive', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'windir']
const systemEnv = () => Object.fromEntries(WINDOWS_SYSTEM_VARIABLES.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]))

// 가짜 명령 하나를 놓는다. Windows 는 첫 줄(#!)로 실행할 프로그램을 고르지 못해서, 같은 이름의 배치 파일이 sh 로 그 스크립트를 돌린다.
function writeFakeCommand(binDir, name, body) {
  writeFileSync(join(binDir, name), `#!/bin/sh\n${body}\n`)
  chmodSync(join(binDir, name), 0o755)
  if (IS_WINDOWS) writeFileSync(join(binDir, `${name}.cmd`), `@sh "%~dp0${name}" %*\r\n`)
}

// 사용자 git 설정을 읽지 않게 하는 값. Windows 의 git 은 /dev/null 을 파일로 열지 못해서 빈 파일을 준다.
function emptyGitConfig(homeDir) {
  if (!IS_WINDOWS) return '/dev/null'
  writeFileSync(join(homeDir, 'empty.gitconfig'), '')
  return join(homeDir, 'empty.gitconfig')
}

/**
 * 격리된 머신. bin 은 { 명령 이름: 셸 스크립트 본문 } 이고 PATH 의 맨 앞 폴더에 실행 파일로 놓인다.
 * home 에는 { 상대 경로: 내용 } 을 줄 수 있다(개인 설정 · 설치 기록).
 */
export function makeMachine({ bin = {}, home = {}, env = {} } = {}) {
  const homeDir = makeTempDir()
  const binDir = join(homeDir, 'bin')
  mkdirSync(binDir)
  for (const [name, body] of Object.entries(bin)) writeFakeCommand(binDir, name, body)
  writeFiles(homeDir, home)
  const isolated = { PATH: `${binDir}${delimiter}${BASE_PATH}`, HOME: homeDir, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyGitConfig(homeDir) }
  return { home: homeDir, env: { ...(IS_WINDOWS ? systemEnv() : {}), ...isolated, ...env }, now: () => FIXED_NOW }
}

// 가짜 레인키퍼 명령. init 은 설정 파일을 만들고, doctor 는 codegraph 줄 하나를 낸다.
export const FAKE_LANEKEEPER = `
if [ "$1" = "init" ]; then
  mkdir -p .lanekeeper
  printf '{ "version": 1, "project_kind": "%s", "gate": { "command": "%s" } }\\n' "$3" "$7" > .lanekeeper/config.json
  echo "created .lanekeeper/config.json"
fi
if [ "$1" = "doctor" ]; then
  echo "✓ git: ok"
  echo "\${FAKE_CODEGRAPH_LINE:-✓ codegraph index: ok}"
fi`

// 가짜 gitleaks. detect 로 부르면 --report-path 에 빈 보고를 쓰고 0 으로 끝난다. 그 밖에는 버전 한 줄을 낸다.
export const FAKE_GITLEAKS = `
if [ "$1" = "detect" ]; then
  while [ $# -gt 0 ]; do
    if [ "$1" = "--report-path" ]; then printf '[]' > "$2"; fi
    shift
  done
  exit 0
fi
echo 8.0.0`

/** 설치 기록과 켜짐 표시. plugins 는 { 이름: 버전 } 이고, disabled 에 든 이름은 꺼진 것으로 적는다. */
export function pluginHome(plugins, disabled = []) {
  const key = (name) => `${name}@acme-plugins`
  const installed = Object.fromEntries(Object.entries(plugins).map(([name, version]) => [key(name), [{ scope: 'user', version }]]))
  const enabledPlugins = Object.fromEntries(Object.keys(plugins).map((name) => [key(name), !disabled.includes(name)]))
  return {
    '.claude/plugins/installed_plugins.json': { version: 2, plugins: installed },
    '.claude/settings.json': { enabledPlugins },
  }
}

const STUB_CHECK = (id) => `export const meta = { id: ${JSON.stringify(id)}, profiles: ['light', 'changed', 'full'], defaultMode: 'warn', ratchetable: false }
export async function run() {
  return { status: 'pass', summary: 'stub', findings: [], metrics: {} }
}
`

/**
 * 플러그인의 사본(kit · templates · modules)을 임시 폴더에 만든다. edit(dir) 로 사본을 고쳐 「새 버전」을 흉내 낸다.
 * stubChecks 가 참이면 아직 없는 검사 파일을 항상 통과하는 가짜로 채워, light 게이트가 끝까지 돌게 한다.
 */
export function makePluginRoot({ stubChecks = false, modules = [], edit } = {}) {
  const dir = makeTempDir()
  for (const folder of ['kit', 'templates', 'modules']) {
    if (existsSync(join(REPO_ROOT, folder))) cpSync(join(REPO_ROOT, folder), join(dir, folder), { recursive: true })
  }
  for (const name of modules) {
    if (!existsSync(join(dir, 'modules', name))) writeFiles(dir, { [`modules/${name}/module.json`]: { name } })
  }
  if (stubChecks) {
    const absent = defaultRegistry(join(dir, 'kit')).filter((entry) => !existsSync(entry.file))
    for (const entry of absent) {
      mkdirSync(dirname(entry.file), { recursive: true })
      writeFileSync(entry.file, STUB_CHECK(entry.id))
    }
  }
  if (edit) edit(dir)
  return dir
}

/** 빈 git 저장소. files 를 주면 그 파일을 놓는다(커밋하지 않는다). */
export function makeRepo(files = {}) {
  const dir = makeTempDir()
  git(dir, 'init', '-q', '-b', 'main')
  writeFiles(dir, files)
  return dir
}

/** 하위 명령 모듈의 run 을 불러 { code, output } 을 돌려준다. */
export async function runCommandModule(commandModule, { cwd, argv = [], machine, pluginRoot = REPO_ROOT, version = VERSION, lang }) {
  let output = ''
  const context = { argv, cwd, write: (text) => { output += text }, t: createCliTranslator(lang ?? 'ko'), pluginRoot, version, requestedLang: lang }
  const code = await commandModule.run(context, machine)
  return { code, output }
}

/** 점검 항목 하나를 돌린다. */
export function runDoctorCheck(checkModule, root, machine, plugin = {}) {
  const context = createDoctorContext({ root, translate: createCliTranslator('ko'), pluginRoot: plugin.root ?? REPO_ROOT, version: plugin.version ?? VERSION }, machine)
  return checkModule.check(context)
}

/** 폴더의 파일 내용을 { 상대 경로: 본문 } 으로 읽는다. skip 으로 시작하는 경로는 뺀다. */
export function snapshotTree(dir, skip = []) {
  const kept = listFiles(dir).filter((path) => !skip.some((prefix) => path.startsWith(prefix)))
  return Object.fromEntries(kept.map((path) => [path, readFileSync(join(dir, path), 'utf8')]))
}
