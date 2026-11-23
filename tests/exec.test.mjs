// 외부 명령 실행 테스트 — PATH 에서 실행 파일 찾기(Windows 의 확장자 포함)와 명령 실행 결과의 모양을 본다.
// 대상: kit/lib/exec.mjs.
// 먼저 읽을 파일: ../kit/lib/exec.mjs.
import assert from 'node:assert/strict'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'
import { findExecutable, runShell, runTool } from '../kit/lib/exec.mjs'
import { executableNames } from '../kit/lib/platform.mjs'
import { makeTempDir, writeFiles } from './helpers.mjs'

test('PATH 의 폴더를 앞에서부터 보고, 없으면 null 이다', () => {
  const first = makeTempDir()
  const second = makeTempDir()
  writeFiles(second, { tool: '' })
  // 실제 폴더를 쓰므로 이 머신의 플랫폼과 구분 글자로 본다. Windows 의 경로에는 `:` 이 있어 다른 플랫폼의 구분 글자로는 나눌 수 없다.
  // 플랫폼마다 어느 글자로 나누는지는 platform.test.mjs 가 본다.
  assert.equal(findExecutable('tool', { PATH: [first, second].join(delimiter) }), join(second, 'tool'))
  assert.equal(findExecutable('tool', { PATH: first }), null)
  assert.equal(findExecutable('tool', {}), null)
  assert.equal(findExecutable('tool', { PATH: '/opt/none:/opt/absent' }, 'linux'), null)
})

test('Windows 에서는 PATHEXT 의 확장자를 붙인 이름을 확장자 없는 이름보다 먼저 찾는다', () => {
  assert.deepEqual(executableNames('npm', { PATHEXT: '.EXE;.CMD' }, 'win32'), ['npm.exe', 'npm.cmd', 'npm'])
  assert.deepEqual(executableNames('npm', {}, 'linux'), ['npm'])
  const dir = makeTempDir()
  writeFiles(dir, { npm: '#!/bin/sh\n', 'npm.cmd': '@echo off\n' })
  assert.equal(findExecutable('npm', { Path: `C:\\nowhere;${dir}`, PATHEXT: '.EXE;.CMD' }, 'win32'), join(dir, 'npm.cmd'))
  assert.equal(findExecutable('npm', { Path: dir, PATHEXT: '' }, 'win32'), join(dir, 'npm.cmd'), 'PATHEXT 가 비면 기본 확장자를 쓴다')
  assert.equal(findExecutable('npm', { Path: dir, PATHEXT: '.EXE' }, 'win32'), join(dir, 'npm'), '확장자를 붙인 이름이 없으면 이름 그대로를 본다')
})

test('명령을 돌리면 종료 코드와 출력을 돌려주고, 시작하지 못해도 던지지 않는다', () => {
  const done = runTool(process.execPath, ['-e', 'process.stdout.write("out"); process.exit(3)'])
  assert.deepEqual([done.code, done.stdout, done.failedToStart], [3, 'out', false])
  const missing = runTool(join(makeTempDir(), 'no-such-tool'), [])
  assert.equal(missing.failedToStart, true)
  assert.notEqual(missing.startError, '')
  assert.equal(runShell('exit 4').code, 4)
})
