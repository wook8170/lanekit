// 잠금 파일과 명령 진입점 테스트 — 복사본의 「그대로 · 고침 · 없음」 판정과 lanekit 명령의 갈림을 본다.
// 대상: lib/lock.mjs · lib/cli.mjs · lib/messages.mjs.
// 먼저 읽을 파일: ../lib/lock.mjs.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { runTool } from '../kit/lib/exec.mjs'
import { runCli, splitArgs } from '../lib/cli.mjs'
import { buildLock, compareWithLock, diffLock, hashFile, listFiles, readLock, writeLock } from '../lib/lock.mjs'
import { IS_WINDOWS, makeTempDir, readJson, writeFiles } from './helpers.mjs'

const VERSION = readJson(new URL('../package.json', import.meta.url)).version

function makeCopy() {
  const dir = makeTempDir()
  writeFiles(dir, { 'gate.mjs': 'export {}\n', 'lib/config.mjs': 'export const one = 1\n', 'checks/guidance/run.mjs': 'export const two = 2\n' })
  writeLock(dir, buildLock(dir, '0.1.0'))
  return dir
}

test('잠금 파일에는 버전과 파일별 sha256 이 들어간다', () => {
  const dir = makeCopy()
  const lock = readLock(dir)
  assert.equal(lock.schema, 'lanekit-lock/1')
  assert.equal(lock.version, '0.1.0')
  assert.deepEqual(Object.keys(lock.files), ['checks/guidance/run.mjs', 'gate.mjs', 'lib/config.mjs'])
  assert.equal(lock.files['gate.mjs'], hashFile(join(dir, 'gate.mjs')))
  assert.match(lock.files['gate.mjs'], /^[0-9a-f]{64}$/)
})

test('복사 직후에는 모든 파일이 「그대로」다', () => {
  const compared = compareWithLock(makeCopy())
  assert.deepEqual({ modified: compared.modified, missing: compared.missing, extra: compared.extra }, { modified: [], missing: [], extra: [] })
  assert.equal(compared.same.length, 3)
  assert.equal(compared.version, '0.1.0')
})

test('고친 파일 · 지운 파일 · 더한 파일을 가른다', () => {
  const dir = makeCopy()
  writeFiles(dir, { 'lib/config.mjs': 'export const one = 100\n', 'checks/custom/run.mjs': 'export {}\n' })
  rmSync(join(dir, 'gate.mjs'))
  const compared = compareWithLock(dir)
  assert.deepEqual(compared.modified, ['lib/config.mjs'])
  assert.deepEqual(compared.missing, ['gate.mjs'])
  assert.deepEqual(compared.extra, ['checks/custom/run.mjs'])
  assert.deepEqual(compared.same, ['checks/guidance/run.mjs'])
})

test('기준선과 잠금 파일 자신은 잠금 대상이 아니다', () => {
  const dir = makeCopy()
  writeFiles(dir, { 'baselines/structure.json': '{}\n', 'baselines/relock-log.jsonl': '{}\n' })
  assert.deepEqual(compareWithLock(dir).extra, [])
  assert.equal(Object.keys(buildLock(dir, '0.1.0').files).some((path) => path.startsWith('baselines/') || path === 'lanekit.lock.json'), false)
})

test('잠금 파일이 없거나 모양이 다르면 null 이다', () => {
  const dir = makeTempDir()
  assert.equal(compareWithLock(dir), null)
  writeFiles(dir, { 'lanekit.lock.json': { schema: 'other/1' } })
  assert.equal(readLock(dir), null)
})

test('diffLock 은 해시 두 벌만으로 판정한다', () => {
  const compared = diffLock({ 'a.mjs': 'h1', 'b.mjs': 'h2', 'c.mjs': 'h3' }, { 'a.mjs': 'h1', 'b.mjs': 'changed', 'd.mjs': 'h4' })
  assert.deepEqual(compared, { same: ['a.mjs'], modified: ['b.mjs'], missing: ['c.mjs'], extra: ['d.mjs'] })
})

test('listFiles 는 하위 폴더까지 이름순으로 낸다', () => {
  const dir = makeTempDir()
  writeFiles(dir, { 'b.mjs': '', 'a/z.mjs': '', 'a/b/c.mjs': '' })
  assert.deepEqual(listFiles(dir), ['a/b/c.mjs', 'a/z.mjs', 'b.mjs'])
})

async function cli(argv, cwd = makeTempDir()) {
  let output = ''
  const code = await runCli({ argv, cwd, write: (text) => { output += text } })
  return { code, output }
}

test('lanekit version 은 package.json 의 버전을 낸다', async () => {
  assert.deepEqual(await cli(['version']), { code: 0, output: `${VERSION}\n` })
  assert.equal(readJson(new URL('../.claude-plugin/plugin.json', import.meta.url)).version, VERSION, 'plugin.json 의 버전과 같다')
})

test('plugin.json 에 의존 플러그인 두 개가 적혀 있다', () => {
  assert.deepEqual(readJson(new URL('../.claude-plugin/plugin.json', import.meta.url)).dependencies, ['lanekeeper', 'wook-skills'])
})

test('인자가 없으면 사용법을 내고, 모르는 명령은 2 다', async () => {
  const help = await cli([])
  assert.equal(help.code, 0)
  assert.match(help.output, /init .*doctor .*update .*version/s)
  const unknown = await cli(['deploy'])
  assert.equal(unknown.code, 2)
  assert.match(unknown.output, /모르는 명령이다: deploy/)
})

test('--lang 과 프로젝트 설정으로 메시지 언어가 정해진다', async () => {
  assert.match((await cli(['--lang', 'en', 'deploy'])).output, /Unknown command: deploy/)
  const englishProject = makeTempDir()
  writeFiles(englishProject, { 'lanekit.config.json': { lang: 'en' } })
  assert.match((await cli(['deploy'], englishProject)).output, /Unknown command/)
  const brokenProject = makeTempDir()
  writeFiles(brokenProject, { 'lanekit.config.json': '{ broken' })
  assert.match((await cli(['deploy'], brokenProject)).output, /모르는 명령이다/, '설정이 깨져 있으면 기본 언어로 간다')
})

test('splitArgs 는 --lang 을 떼어 내고 하위 명령과 나머지를 가른다', () => {
  assert.deepEqual(splitArgs(['--lang', 'en', 'init', '--yes']), { lang: 'en', command: 'init', commandArgs: ['--yes'] })
  assert.deepEqual(splitArgs(['doctor', '--json', '--lang', 'ko']), { lang: 'ko', command: 'doctor', commandArgs: ['--json'] })
  assert.deepEqual(splitArgs([]), { lang: undefined, command: undefined, commandArgs: [] })
})

test('bin/lanekit 을 실행 파일로 부를 수 있다', () => {
  // Windows 는 첫 줄(#!)로 실행하지 못한다. 그래서 그 플랫폼의 진입점인 lanekit.cmd 를 제품과 같은 방법(runTool)으로 부른다.
  const bin = fileURLToPath(new URL(IS_WINDOWS ? '../bin/lanekit.cmd' : '../bin/lanekit', import.meta.url))
  const called = runTool(bin, ['version'])
  assert.deepEqual([called.code, called.stdout.trim()], [0, VERSION], called.stderr || called.startError)
})
