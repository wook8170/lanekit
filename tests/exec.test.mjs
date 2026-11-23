// 외부 명령 실행 테스트 — PATH 에서 실행 파일 찾기(Windows 의 확장자 포함)와 명령 실행 결과의 모양을 본다.
// 대상: kit/lib/exec.mjs.
// 먼저 읽을 파일: ../kit/lib/exec.mjs.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { findExecutable, runShell, runTool } from '../kit/lib/exec.mjs'
import { executableNames } from '../kit/lib/platform.mjs'
import { makeTempDir, writeFiles } from './helpers.mjs'

test('PATH 의 폴더를 앞에서부터 보고, 없으면 null 이다', () => {
  const first = makeTempDir()
  const second = makeTempDir()
  writeFiles(second, { tool: '' })
  assert.equal(findExecutable('tool', { PATH: `${first}:${second}` }, 'linux'), join(second, 'tool'))
  assert.equal(findExecutable('tool', { PATH: first }, 'linux'), null)
  assert.equal(findExecutable('tool', {}, 'linux'), null)
})

test('Windows 에서는 PATHEXT 의 확장자를 붙인 이름을 확장자 없는 이름보다 먼저 찾는다', () => {
  assert.deepEqual(executableNames('npm', { PATHEXT: '.EXE;.CMD' }, 'win32'), ['npm.exe', 'npm.cmd', 'npm'])
  assert.deepEqual(executableNames('npm', {}, 'linux'), ['npm'])
  const dir = makeTempDir()
  writeFiles(dir, { npm: '#!/bin/sh\n', 'npm.cmd': '@echo off\n' })
  assert.equal(findExecutable('npm', { Path: `C:\\nowhere;${dir}`, PATHEXT: '.EXE;.CMD' }, 'win32'), join(dir, 'npm.cmd'))
  assert.equal(findExecutable('npm', { PATH: dir }, 'linux'), join(dir, 'npm'))
})

test('명령을 돌리면 종료 코드와 출력을 돌려주고, 시작하지 못해도 던지지 않는다', () => {
  const done = runTool(process.execPath, ['-e', 'process.stdout.write("out"); process.exit(3)'])
  assert.deepEqual([done.code, done.stdout, done.failedToStart], [3, 'out', false])
  const missing = runTool(join(makeTempDir(), 'no-such-tool'), [])
  assert.equal(missing.failedToStart, true)
  assert.notEqual(missing.startError, '')
  assert.equal(runShell('exit 4').code, 4)
})
