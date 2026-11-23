// doctor 테스트(G · W · C) — 레인키퍼 연결, pre-push 훅, CI 파일, 증거 파일, 문서 검색 · 위키 · codegraph 항목의 정상 사례와 문제 사례를 본다.
// 대상: lib/doctor-checks/ 의 g1 ~ g5 · w1 · w2 · c1.
// 먼저 읽을 파일: ../lib/lanekeeper-link.mjs(init 이 넣는 값).
import assert from 'node:assert/strict'
import { chmodSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import * as c1 from '../lib/doctor-checks/c1-codegraph.mjs'
import * as g1 from '../lib/doctor-checks/g1-gate-command.mjs'
import * as g2 from '../lib/doctor-checks/g2-release-gate.mjs'
import * as g3 from '../lib/doctor-checks/g3-push-hook.mjs'
import * as g4 from '../lib/doctor-checks/g4-ci-file.mjs'
import * as g5 from '../lib/doctor-checks/g5-head-evidence.mjs'
import * as w1 from '../lib/doctor-checks/w1-docs-search.mjs'
import * as w2 from '../lib/doctor-checks/w2-wiki-index.mjs'
import { lanekeeperValues } from '../lib/lanekeeper-link.mjs'
import { commitAll, gate, git, makeProject, makeTempDir, POSIX_ONLY, writeFiles } from './helpers.mjs'
import { FAKE_LANEKEEPER, makeMachine, runDoctorCheck } from './scaffold-helpers.mjs'

const machine = makeMachine()
const check = (checkModule, root, plugin) => runDoctorCheck(checkModule, root, machine, plugin)
const LINKED = { '.lanekeeper/config.json': lanekeeperValues('ko') }

test('G1: 레인키퍼의 게이트 명령이 gate.mjs 를 부르지 않거나 설정이 없으면 warn 이다', () => {
  assert.equal(check(g1, makeProject({}, LINKED)).status, 'ok')
  const other = check(g1, makeProject({}, { '.lanekeeper/config.json': { gate: { command: 'npm run verify' } } }))
  assert.equal(other.status, 'warn')
  assert.match(other.message, /npm run verify/)
  const absent = check(g1, makeProject({}))
  assert.equal(absent.status, 'warn')
  assert.match(absent.fix, /\/lanekeeper:init/)
})

test('G2: 출하 관문에 full 프로필 게이트가 없으면 warn 이다', () => {
  assert.equal(check(g2, makeProject({}, LINKED)).status, 'ok')
  const lightOnly = { '.lanekeeper/config.json': { release: { gates: [{ name: 'light', command: 'node scripts/lanekit/gate.mjs --profile light' }] } } }
  assert.equal(check(g2, makeProject({}, lightOnly)).status, 'warn')
  assert.equal(check(g2, makeProject({})).status, 'warn')
})

test('G3: 훅 폴더가 설정되지 않았거나 pre-push 가 실행 가능하지 않으면 warn 이다', { skip: POSIX_ONLY }, () => {
  const dir = makeProject({}, { '.githooks/pre-push': '#!/bin/sh\n' })
  git(dir, 'init', '-q', '-b', 'main')
  const unset = check(g3, dir)
  assert.equal(unset.status, 'warn')
  assert.match(unset.fix, /git config core\.hooksPath \.githooks/)
  git(dir, 'config', 'core.hooksPath', '.githooks')
  assert.equal(check(g3, dir).status, 'warn', '실행 권한이 없다')
  chmodSync(join(dir, '.githooks/pre-push'), 0o755)
  assert.equal(check(g3, dir).status, 'ok')
  assert.equal(check(g3, makeProject({ remote_gate: 'none' })).status, 'ok', '원격 관문이 none 이면 보지 않는다')
})

test('G4: 원격 관문이 github · gitlab 인데 게이트를 부르는 CI 파일이 없으면 warn 이다', () => {
  const call = 'run: node scripts/lanekit/gate.mjs --profile changed\n'
  assert.equal(check(g4, makeProject({})).status, 'ok', 'git-hook 은 CI 파일을 보지 않는다')
  assert.equal(check(g4, makeProject({ remote_gate: 'github' })).status, 'warn')
  assert.equal(check(g4, makeProject({ remote_gate: 'github' }, { '.github/workflows/ci.yml': 'run: npm test\n' })).status, 'warn')
  assert.equal(check(g4, makeProject({ remote_gate: 'github' }, { '.github/workflows/lanekit-gate.yml': call })).status, 'ok')
  const template = { '.gitlab/lanekit-gate.gitlab-ci.yml': call }
  const notIncluded = check(g4, makeProject({ remote_gate: 'gitlab' }, template))
  assert.equal(notIncluded.status, 'warn', '틀만 놓고 include 하지 않으면 돌지 않는다')
  assert.match(notIncluded.fix, /include/)
  const included = { ...template, '.gitlab-ci.yml': 'include: [{ local: ".gitlab/lanekit-gate.gitlab-ci.yml" }]\n' }
  assert.equal(check(g4, makeProject({ remote_gate: 'gitlab' }, included)).status, 'ok')
  assert.equal(check(g4, makeProject({ remote_gate: 'gitlab' }, { '.gitlab-ci.yml': call })).status, 'ok')
})

test('G5: HEAD 에서 게이트를 돌린 증거 파일이 없으면 warn 이고, 일부만 돌린 기록은 세지 않는다', async () => {
  const unborn = makeProject({})
  git(unborn, 'init', '-q', '-b', 'main')
  assert.equal(check(g5, unborn).status, 'warn', '커밋이 없다')
  const dir = makeProject({}, { 'CLAUDE.md': '# acme\n', 'AGENTS.md': '# 지침\n' })
  commitAll(dir)
  assert.equal(check(g5, dir).status, 'warn')
  await gate(dir, ['--only', 'guidance'])
  assert.equal(check(g5, dir).status, 'warn', '-partial 증거는 세지 않는다')
  const head = git(dir, 'rev-parse', 'HEAD')
  const evidence = { schema: 'lanekit-evidence/1', dirty: false, failed: [] }
  const place = (record, profile = 'light') => writeFiles(dir, { [`.lanekit/evidence/${head.slice(0, 12)}-${profile}.json`]: record })
  place(evidence)
  const found = check(g5, dir)
  assert.equal(found.status, 'ok')
  assert.match(found.message, /light/)
})

test('G5: 증거에 확인하지 못해 건너뛴 검사가 있으면 출하 증거로는 쓰되 경고로 알린다', () => {
  const dir = makeProject({}, { 'a.txt': 'a\n' })
  const head = commitAll(dir)
  const place = (checks) => writeFiles(dir, { [`.lanekit/evidence/${head.slice(0, 12)}-full.json`]: { schema: 'lanekit-evidence/1', dirty: false, failed: [], checks } })
  const passed = { id: 'secrets', status: 'pass', verdict: 'pass', reason: 'clean' }
  place([passed, { id: 'docs-drift', status: 'skip', verdict: 'skip', reason: 'check-skipped' }])
  assert.equal(check(g5, dir).status, 'ok', '볼 것이 없어 건너뛴 검사는 경고가 아니다')
  place([passed, { id: 'audit', status: 'skip', verdict: 'skip', reason: 'check-unverified', summary: 'no result' }])
  const warned = check(g5, dir)
  assert.equal(warned.status, 'warn')
  assert.match(warned.message, /HEAD 의 증거 파일이 있다\(full\)\. 다만 도구가 없거나 결과를 얻지 못해 건너뛴 검사가 있다: audit/)
  assert.deepEqual(g5.unverifiedChecks({ checks: [{ id: 'a', reason: 'check-unverified' }, { id: 'b', reason: 'clean' }] }), ['a'])
  assert.deepEqual(g5.unverifiedChecks(null), [])
})

test('G5: 커밋하지 않은 변경이 있었거나 실패한 실행의 증거는 세지 않는다', () => {
  const dir = makeProject({}, { 'a.txt': 'a\n' })
  const head = commitAll(dir)
  const place = (record) => writeFiles(dir, { [`.lanekit/evidence/${head.slice(0, 12)}-full.json`]: record })
  const evidence = { schema: 'lanekit-evidence/1', dirty: false, failed: [] }
  for (const rejected of [{ ...evidence, dirty: true }, { ...evidence, failed: ['secrets'] }, { schema: 'lanekit-evidence/1' }, '{ broken']) {
    place(rejected)
    const result = check(g5, dir)
    assert.equal(result.status, 'warn', JSON.stringify(rejected))
    assert.match(result.message, /출하 증거로 쓸 수 없다: full/)
  }
  place(evidence)
  assert.equal(check(g5, dir).status, 'ok')
})

test('W1: 문서 폴더가 있는데 문서 검색 명령이 비어 있으면 warn 이다', () => {
  const docs = { 'docs/guide.md': '# 안내\n' }
  assert.equal(check(w1, makeProject({})).status, 'ok', '문서 폴더가 없다')
  const empty = check(w1, makeProject({}, { ...docs, ...LINKED }))
  assert.equal(empty.status, 'warn')
  assert.match(empty.message, /docs/)
  const linked = { ...docs, '.lanekeeper/config.json': { docs_search: { search: 'node wiki-index.mjs search' } } }
  assert.equal(check(w1, makeProject({}, linked)).status, 'ok')
})

test('W2: 게이트의 wiki 검사 결과를 그대로 옮기고, 검사가 없는 설치본에서는 건너뛴다', async () => {
  const pluginWith = (result) => {
    const root = makeTempDir()
    const source = `export const meta = { id: 'wiki', profiles: ['light'], defaultMode: 'warn', ratchetable: false }
export async function run(ctx) {
  if (typeof ctx.root !== 'string' || !ctx.config.checks.wiki || typeof ctx.git.head !== 'function') throw new Error('bad ctx')
  return ${JSON.stringify(result)}
}
`
    writeFiles(root, { 'kit/checks/wiki/run.mjs': source })
    return { root }
  }
  const dir = makeProject({})
  assert.equal((await check(w2, dir, { root: makeTempDir() })).status, 'skip')
  const fresh = await check(w2, dir, pluginWith({ status: 'pass', summary: '색인이 문서와 맞다', findings: [] }))
  assert.deepEqual({ status: fresh.status, message: fresh.message }, { status: 'ok', message: '색인이 문서와 맞다' })
  const stale = await check(w2, dir, pluginWith({ status: 'findings', summary: '색인이 낡았다', findings: [{}] }))
  assert.deepEqual({ status: stale.status, message: stale.message }, { status: 'warn', message: '색인이 낡았다' })
  assert.match(stale.fix, /docs_search\.build/)
  assert.equal((await check(w2, dir, pluginWith({ status: 'skip', summary: '문서 폴더가 없다' }))).status, 'skip')
})

test('C1: 레인키퍼 doctor 의 codegraph 줄을 그대로 옮기고, 레인키퍼가 없으면 건너뛴다', () => {
  const dir = makeProject({})
  assert.equal(check(c1, dir).status, 'skip')
  const withLanekeeper = (line) => makeMachine({ bin: { 'lanekeeper-config': FAKE_LANEKEEPER }, env: line ? { FAKE_CODEGRAPH_LINE: line } : {} })
  const found = runDoctorCheck(c1, dir, withLanekeeper())
  assert.deepEqual({ status: found.status, message: found.message }, { status: 'ok', message: '✓ codegraph index: ok' })
  const troubled = runDoctorCheck(c1, dir, withLanekeeper('! codegraph index: missing'))
  assert.deepEqual({ status: troubled.status, message: troubled.message }, { status: 'warn', message: '! codegraph index: missing' })
  assert.equal(runDoctorCheck(c1, dir, withLanekeeper('✓ wiki: ok')).status, 'skip', 'codegraph 줄이 없다')
})
