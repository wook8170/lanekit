// SBOM · 출처 문서 검사 테스트 — SBOM 쓰기와 실패 알림, 출처 문서의 증거 파일 해시 · SBOM 해시 · 약한 점을 본다.
// 대상: kit/checks/security/sbom.mjs · provenance.mjs.
// 먼저 읽을 파일: ../kit/checks/security/provenance.mjs(출처 문서의 내용).
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { findWeakPoints, meta as provenanceMeta, PROVENANCE_SCHEMA, stripCredentials } from '../kit/checks/security/provenance.mjs'
import { readSbomOutput, run as runSbom, sbomPath } from '../kit/checks/security/sbom.mjs'
import { callCheck, fakeTool, rulesOf, withBarePath } from './check-helpers.mjs'
import { commitAll, gate, git, makeProject, readJson } from './helpers.mjs'

const SBOM_DOCUMENT = { bomFormat: 'CycloneDX', specVersion: '1.5', components: [{ name: 'left-pad' }, { name: 'tiny-lib' }] }
// sh 와 cmd.exe 가 같게 읽는 명령만 쓴다. JSON 을 명령 줄에 적으면 따옴표를 두 셸이 다르게 읽으므로, 문서를 내는 스크립트를 프로젝트에 둔다.
const SBOM_SCRIPT = 'print-sbom.mjs'
const SBOM_COMMAND = `node ${SBOM_SCRIPT}`
const FAILING_COMMAND = `node -e "console.error('broken'); process.exit(4)"`
const sha256Of = (file) => `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`

const project = (sbomCommand = SBOM_COMMAND) =>
  makeProject({ build: { command: 'npm run build' }, checks: { sbom: { command: sbomCommand }, structure: { mode: 'off' }, secrets: { tool: 'builtin' }, tests: { mode: 'off' }, audit: { mode: 'off' } } }, { 'a.txt': 'a\n', [SBOM_SCRIPT]: `process.stdout.write(${JSON.stringify(JSON.stringify(SBOM_DOCUMENT))})\n` })

test('sbom: 설정한 명령의 출력을 커밋 이름으로 쓴다', async () => {
  const dir = project()
  const commit = commitAll(dir)
  const result = await callCheck(runSbom, 'security', dir, { profile: 'full' })
  assert.equal(result.status, 'pass')
  assert.equal(result.metrics.components, 2)
  assert.equal(sbomPath(dir, commit), join(dir, '.lanekit', 'sbom', `${commit.slice(0, 12)}.cdx.json`))
  assert.deepEqual(readJson(sbomPath(dir, commit)), SBOM_DOCUMENT)
})

test('sbom: 명령이 없으면 npm sbom 을 부른다', async () => {
  const fakeNpm = fakeTool('npm', `
if (process.argv.slice(2).join(' ') !== 'sbom --sbom-format cyclonedx') process.exit(9)
process.stdout.write(${JSON.stringify(JSON.stringify(SBOM_DOCUMENT))})`)
  const dir = project('')
  commitAll(dir)
  const result = await withBarePath([fakeNpm], () => callCheck(runSbom, 'security', dir, { profile: 'full' }))
  assert.equal(result.status, 'pass', result.summary)
})

test('sbom: 만들 수 없으면 찾은 것으로 알리고 파일을 쓰지 않는다', async () => {
  const failing = project(FAILING_COMMAND)
  const commit = commitAll(failing)
  const result = await callCheck(runSbom, 'security', failing, { profile: 'full' })
  assert.deepEqual(rulesOf(result), ['sbom-failed'])
  assert.match(result.summary, /exit 4 broken/)
  assert.equal(existsSync(sbomPath(failing, commit)), false)
  assert.deepEqual(readSbomOutput({ code: 0, stdout: 'not json', stderr: '' }), { problem: 'not-json' })
  const noNpm = project('')
  commitAll(noNpm)
  assert.deepEqual(rulesOf(await withBarePath([], () => callCheck(runSbom, 'security', noNpm, { profile: 'full' }))), ['sbom-failed'])
})

test('provenance: 증거 파일 뒤에 돌고, 출처 문서에 증거 파일 해시와 SBOM 해시가 들어간다', async () => {
  assert.equal(provenanceMeta.afterEvidence, true)
  const dir = project()
  const commit = commitAll(dir)
  git(dir, 'tag', 'v1.0.0')
  git(dir, 'remote', 'add', 'origin', 'https://acme:token-value@example.com/acme/acme-app.git')
  const { code, output } = await gate(dir, ['--profile', 'full'])
  assert.equal(code, 0, output)
  const short = commit.slice(0, 12)
  const evidenceFile = join(dir, '.lanekit', 'evidence', `${short}-full.json`)
  const provenance = readJson(join(dir, '.lanekit', 'evidence', `${short}-provenance.json`))
  assert.equal(provenance.schema, PROVENANCE_SCHEMA)
  assert.equal(provenance.commit, commit)
  assert.deepEqual(provenance.tags, ['v1.0.0'])
  assert.equal(provenance.repository, 'https://example.com/acme/acme-app.git')
  assert.deepEqual(provenance.build, { command: 'npm run build' })
  assert.equal(provenance.tools.node, process.version)
  assert.deepEqual(provenance.evidence, { file: `.lanekit/evidence/${short}-full.json`, sha256: sha256Of(evidenceFile), profile: 'full', partial: false })
  assert.deepEqual(provenance.sbom, { file: `.lanekit/sbom/${short}.cdx.json`, sha256: sha256Of(sbomPath(dir, commit)) })
  assert.deepEqual(readJson(evidenceFile).deferred, ['provenance'])
  assert.match(output, /✓ provenance/)
})

test('provenance: 증거 파일이 없으면 문서를 쓰지 않고 찾은 것으로 알린다', async () => {
  const dir = project()
  const commit = commitAll(dir)
  const { code, output } = await gate(dir, ['--profile', 'full', '--only', 'provenance', '--no-evidence'])
  assert.equal(code, 0, '기본 모드는 warn 이다')
  assert.match(output, /\[evidence-missing\]/)
  assert.equal(existsSync(join(dir, '.lanekit', 'evidence', `${commit.slice(0, 12)}-provenance.json`)), false)
})

test('provenance: 일부만 돌린 증거 · 커밋하지 않은 변경 · SBOM 없음을 약한 점으로 알린다', async () => {
  const dir = project()
  commitAll(dir)
  const { output } = await gate(dir, ['--profile', 'full', '--only', 'provenance'])
  assert.match(output, /\[evidence-partial\]/)
  assert.match(output, /\[sbom-missing\]/)
  const short = git(dir, 'rev-parse', 'HEAD').slice(0, 12)
  assert.ok(existsSync(join(dir, '.lanekit', 'evidence', `${short}-provenance-partial.json`)), '일부만 돌린 실행의 출처 문서는 따로 둔다')
  assert.ok(!existsSync(join(dir, '.lanekit', 'evidence', `${short}-provenance.json`)), '온전한 실행의 출처 문서를 덮어쓰지 않는다')
  assert.deepEqual(findWeakPoints({ evidence: { partial: false }, dirty: true, sbom: {} }), ['evidence-dirty'])
  assert.deepEqual(findWeakPoints({ evidence: { partial: false }, dirty: false, sbom: {} }), [])
})

test('저장소 주소에서 인증 정보를 지운다', () => {
  assert.equal(stripCredentials('https://user:secret@example.com/a/b.git'), 'https://example.com/a/b.git')
  assert.equal(stripCredentials('https://token@example.com/a/b.git'), 'https://example.com/a/b.git')
  assert.equal(stripCredentials('https://example.com/a/b.git'), 'https://example.com/a/b.git')
  assert.equal(stripCredentials('git@example.com:a/b.git'), 'git@example.com:a/b.git')
})
