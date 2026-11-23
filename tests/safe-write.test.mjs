// 저장소 안에만 쓰기 테스트 — 게이트가 쓰는 파일(증거 · 기준선 · 재잠금 이력 · 검사의 기록)이 링크를 따라 저장소 밖에 써지지 않는지 본다.
// 대상: kit/lib/safe-write.mjs 와 그것을 쓰는 kit/lib/evidence.mjs · kit/lib/baseline.mjs · kit/checks/tests/run.mjs · kit/checks/security/sbom.mjs.
// 먼저 읽을 파일: helpers.mjs. 설치 명령 쪽의 같은 보호는 init-apply.test.mjs · update.test.mjs 에 있다.
import assert from 'node:assert/strict'
import { chmodSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { run as runSbom } from '../kit/checks/security/sbom.mjs'
import { run as runTests } from '../kit/checks/tests/run.mjs'
import { hasModeBits } from '../kit/lib/platform.mjs'
import { BlockedPathError, appendInside, isBlockedPath, removeInside, writeInside } from '../kit/lib/safe-write.mjs'
import { callCheck } from './check-helpers.mjs'
import { commitAll, gate, makeProject, makeTempDir, planStubResult, stubCheck, writeFiles } from './helpers.mjs'

const BASELINES = 'scripts/lanekit/baselines'
const RELOCK = ['--relock', 'structure', '--reason', 'init']

function makeStubProject(config = {}) {
  const dir = makeProject(config)
  planStubResult(dir, 'structure', { status: 'pass', current: { 'rule-a': { 'src/a.ts': 1 } } })
  return { dir, registry: [stubCheck('structure')] }
}

test('하드 링크인 파일에 쓰면 그 자리의 파일만 바뀐다. 저장소 밖에 있는 다른 이름의 내용은 바뀌지 않는다', () => {
  const root = makeTempDir()
  const outside = makeTempDir()
  writeFiles(outside, { 'kept.txt': 'outside\n', 'log.txt': 'first\n' })
  linkSync(join(outside, 'kept.txt'), join(root, 'linked.txt'))
  linkSync(join(outside, 'log.txt'), join(root, 'log.txt'))
  chmodSync(join(root, 'linked.txt'), 0o640)
  assert.equal(isBlockedPath(root, 'linked.txt'), false, 'cp -al 로 만든 복사본에서도 쓸 수 있어야 한다')
  writeInside(root, 'linked.txt', 'overwritten\n')
  appendInside(root, 'log.txt', 'second\n')
  assert.equal(readFileSync(join(root, 'linked.txt'), 'utf8'), 'overwritten\n')
  assert.equal(readFileSync(join(root, 'log.txt'), 'utf8'), 'first\nsecond\n')
  assert.equal(readFileSync(join(outside, 'kept.txt'), 'utf8'), 'outside\n')
  assert.equal(readFileSync(join(outside, 'log.txt'), 'utf8'), 'first\n')
  if (hasModeBits()) assert.equal(statSync(join(root, 'linked.txt')).mode & 0o777, 0o640, '있던 파일의 권한을 지킨다')
  assert.deepEqual(readdirSync(root).sort(), ['linked.txt', 'log.txt'], '임시 파일을 남기지 않는다')
  linkSync(join(outside, 'kept.txt'), join(root, 'removable.txt'))
  removeInside(root, 'removable.txt')
  assert.equal(readFileSync(join(outside, 'kept.txt'), 'utf8'), 'outside\n', '지우기는 다른 이름에 영향이 없다')
  writeInside(root, 'tool.sh', '#!/bin/sh\n', { executable: true })
  if (hasModeBits()) assert.equal(statSync(join(root, 'tool.sh')).mode & 0o111, 0o111)
})

test('쓰다 죽은 실행이 남긴 임시 파일은 같은 파일을 다시 쓸 때 지운다. 한 시간이 안 된 것과 꼴이 다른 것은 둔다', () => {
  const root = makeTempDir()
  const [stale, fresh, other] = ['data.json.0123456789ab.tmp', 'data.json.ba9876543210.tmp', 'data.json.backup.tmp']
  writeFiles(root, { [stale]: 'x', [fresh]: 'x', [other]: 'x', 'else.json.0123456789ab.tmp': 'x' })
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
  for (const name of [stale, other, 'else.json.0123456789ab.tmp']) utimesSync(join(root, name), twoHoursAgo, twoHoursAgo)
  writeInside(root, 'data.json', '{}\n')
  assert.deepEqual(readdirSync(root).sort(), ['data.json', fresh, other, 'else.json.0123456789ab.tmp'].sort())
})

test('이름 바꾸기가 실패하면 임시 파일을 남기지 않는다', () => {
  const root = makeTempDir()
  mkdirSync(join(root, 'taken/inner'), { recursive: true })
  assert.throws(() => writeInside(root, 'taken', 'x\n'))
  assert.deepEqual(readdirSync(root), ['taken'])
})

test('.lanekit 이 저장소 밖을 가리키는 링크면 증거 파일을 쓰지 않고 2 로 끝난다', async () => {
  const { dir, registry } = makeStubProject()
  const outside = makeTempDir()
  symlinkSync(outside, join(dir, '.lanekit'))
  const { code, output } = await gate(dir, [], registry)
  assert.equal(code, 2)
  assert.match(output, /\.lanekit\/evidence\/no-git-light\.json: 쓰지 않는다/)
  assert.deepEqual(readdirSync(outside), [])
})

test('기준선 폴더가 저장소 밖을 가리키는 링크면 재잠금을 쓰지 않고 2 로 끝난다', async () => {
  const { dir, registry } = makeStubProject()
  const outside = makeTempDir()
  mkdirSync(join(dir, 'scripts/lanekit'), { recursive: true })
  symlinkSync(outside, join(dir, BASELINES))
  const { code, output } = await gate(dir, RELOCK, registry)
  assert.equal(code, 2)
  assert.match(output, /scripts\/lanekit\/baselines\/relock-log\.jsonl: 쓰지 않는다/)
  assert.deepEqual(readdirSync(outside), [])
})

test('재잠금 이력이 저장소 밖 파일의 하드 링크여도 재잠금은 되고, 저장소 밖 파일은 그대로다', async () => {
  const { dir, registry } = makeStubProject()
  const outside = makeTempDir()
  writeFiles(outside, { 'log.jsonl': '' })
  mkdirSync(join(dir, BASELINES), { recursive: true })
  linkSync(join(outside, 'log.jsonl'), join(dir, BASELINES, 'relock-log.jsonl'))
  assert.equal((await gate(dir, RELOCK, registry)).code, 0)
  assert.equal(existsSync(join(dir, BASELINES, 'structure.json')), true)
  assert.equal(readFileSync(join(dir, BASELINES, 'relock-log.jsonl'), 'utf8').trim().split('\n').length, 1)
  assert.equal(readFileSync(join(outside, 'log.jsonl'), 'utf8'), '')
})

test('검사의 기록 파일(테스트 출력 · SBOM)도 링크를 따라 저장소 밖에 쓰지 않는다', async () => {
  const dir = makeProject({ checks: { tests: { full: 'node -e 0' }, sbom: { command: 'node -e "console.log(JSON.stringify({bomFormat:\'CycloneDX\',components:[]}))"' } } })
  commitAll(dir)
  const outside = makeTempDir()
  symlinkSync(outside, join(dir, '.lanekit'))
  await assert.rejects(() => callCheck(runTests, 'tests', dir, { profile: 'full' }), BlockedPathError)
  await assert.rejects(() => callCheck(runSbom, 'security', dir, { profile: 'full' }), BlockedPathError)
  assert.deepEqual(readdirSync(outside), [])
})
