// 공개 노출 검사 테스트 — 금지어 목록 찾기, 맞은 낱말을 출력하지 않기, 이력, 허용, 목록이 없을 때의 종료 코드를 본다.
// 대상: kit/checks/exposure/run.mjs · denylist.mjs.
// 먼저 읽을 파일: ../kit/checks/exposure/denylist.mjs(목록 읽기).
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { findDenylistFile, matchRuleNumbers, parseDenylist } from '../kit/checks/exposure/denylist.mjs'
import { dropAllowed, run } from '../kit/checks/exposure/run.mjs'
import { userConfigDir } from '../kit/lib/platform.mjs'
import { callCheck, withEnv } from './check-helpers.mjs'
import { commitAll, gate, git, makeProject, makeTempDir, readJson, writeFiles } from './helpers.mjs'

const WORD = 'zebracorn'
const DENYLIST = `# 금지어 목록\n${WORD}\n\ninternal-\\d+\\.example\\.com\n`

function denylistFile(text = DENYLIST) {
  const dir = makeTempDir()
  writeFiles(dir, { 'denylist.txt': text })
  return join(dir, 'denylist.txt')
}

const publicProject = (files, exposure = {}) => makeProject({ repo: { visibility: 'public' }, checks: { exposure } }, files)
const emptyHome = () => makeTempDir()
const withDenylist = (file, action) => withEnv({ LANEKIT_DENYLIST: file, HOME: emptyHome() }, action)
const withoutDenylist = (action) => withEnv({ LANEKIT_DENYLIST: undefined, HOME: emptyHome() }, action)

test('목록 읽기: 주석과 빈 줄은 건너뛰고 규칙 번호는 목록의 줄 번호다', () => {
  const { rules, invalidLines } = parseDenylist(`${DENYLIST}(broken\n`)
  assert.deepEqual(rules.map((rule) => rule.number), [2, 4])
  assert.deepEqual(invalidLines, [5])
  assert.deepEqual(matchRuleNumbers(`The ${WORD.toUpperCase()} host is internal-12.example.com`, rules), [2, 4])
  assert.deepEqual(matchRuleNumbers('nothing here', rules), [])
})

test('금지어 대조는 유니코드 정규화가 달라도 맞춘다: 풀어 쓴 꼴(NFD)의 한글 줄과 목록', () => {
  const word = '얼룩뿔말'
  const [composed, decomposed] = [word.normalize('NFC'), word.normalize('NFD')]
  assert.notEqual(composed, decomposed)
  const composedRules = parseDenylist(`${composed}\n`).rules
  assert.deepEqual(matchRuleNumbers(`![](${decomposed}-화면.png)`, composedRules), [1], 'macOS 에서 복사한 파일 이름')
  assert.deepEqual(matchRuleNumbers(`![](${composed}-화면.png)`, composedRules), [1])
  assert.deepEqual(matchRuleNumbers(`refs/heads/${composed}`, parseDenylist(`${decomposed}\n`).rules), [1], '목록이 NFD 로 적힌 경우')
})

test('목록 찾기: 환경 변수가 먼저고 다음은 사용자 설정 폴더다', () => {
  const home = makeTempDir()
  assert.equal(findDenylistFile({ HOME: home }), null)
  const inConfigDir = join(userConfigDir({ env: {}, home }), 'denylist.txt')
  mkdirSync(dirname(inConfigDir), { recursive: true })
  writeFileSync(inConfigDir, WORD)
  assert.equal(findDenylistFile({ HOME: home }), inConfigDir)
  const fromEnv = denylistFile()
  assert.equal(findDenylistFile({ HOME: home, LANEKIT_DENYLIST: fromEnv }), fromEnv)
})

test('찾으면 파일 · 줄 · 규칙 번호만 낸다. 맞은 낱말은 출력과 증거 파일 어디에도 없다', async () => {
  const dir = publicProject({ 'docs/a.md': `first\nThe ${WORD} project\n`, 'src/host.mjs': 'const host = "internal-7.example.com"\n' })
  const commit = commitAll(dir)
  const result = await withDenylist(denylistFile(), () => callCheck(run, 'exposure', dir, { mode: 'fail' }))
  assert.deepEqual(result.findings.map((found) => [found.file, found.line, found.rule]), [['docs/a.md', 2, 'deny-2'], ['src/host.mjs', 1, 'deny-4']])
  assert.equal(result.findings[0].message, '금지어 목록 2번 줄의 규칙에 맞는다')
  const gated = await withDenylist(denylistFile(), () => gate(dir, ['--only', 'exposure', '--json', 'out.json']))
  assert.equal(gated.code, 1)
  const evidence = JSON.stringify(readJson(join(dir, '.lanekit', 'evidence', `${commit.slice(0, 12)}-light-partial.json`)))
  for (const text of [JSON.stringify(result), gated.output, evidence, JSON.stringify(readJson(join(dir, 'out.json')))]) {
    assert.ok(!text.toLowerCase().includes(WORD), '맞은 낱말이 나오면 안 된다')
    assert.ok(!text.includes('internal-7'), '맞은 낱말이 나오면 안 된다')
  }
})

test('추적 중인 파일만 본다. 파일 이름도 보고, 바이너리는 건너뛴다', async () => {
  const dir = publicProject({ [`docs/${WORD}.md`]: 'clean\n', 'blob.bin': `\u0000${WORD}` })
  commitAll(dir)
  writeFiles(dir, { 'untracked.txt': WORD })
  const result = await withDenylist(denylistFile(), () => callCheck(run, 'exposure', dir))
  assert.deepEqual(result.findings.map((found) => [found.line, found.rule]), [[null, 'deny-2']])
})

test('full 프로필은 지운 내용과 커밋 메시지도 이력에서 찾는다', async () => {
  const dir = publicProject({ 'a.txt': `${WORD}\n` })
  const first = commitAll(dir)
  writeFiles(dir, { 'a.txt': 'clean\n' })
  git(dir, 'commit', '-q', '-am', `remove the ${WORD} name`)
  const second = git(dir, 'rev-parse', 'HEAD')
  const light = await withDenylist(denylistFile(), () => callCheck(run, 'exposure', dir, { profile: 'light' }))
  assert.equal(light.status, 'pass')
  const full = await withDenylist(denylistFile(), () => callCheck(run, 'exposure', dir, { profile: 'full' }))
  assert.deepEqual(full.findings.map((found) => found.file), [`a.txt@${first.slice(0, 8)}`, `(commit message)@${second.slice(0, 8)}`])
  assert.equal(full.findings[0].message, '이력의 커밋이 금지어 목록 2번 줄의 규칙에 맞는다')
})

test('full 프로필은 커밋의 작성자 이름과 이메일도 본다', async () => {
  const dir = publicProject({ 'a.txt': 'clean\n' })
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'add', '-A')
  git(dir, '-c', `user.email=dev@${WORD}.example`, 'commit', '-q', '-m', 'init')
  const commit = git(dir, 'rev-parse', 'HEAD')
  const full = await withDenylist(denylistFile(), () => callCheck(run, 'exposure', dir, { profile: 'full' }))
  assert.deepEqual([...new Set(full.findings.map((found) => found.file))], [`(commit message)@${commit.slice(0, 8)}`])
})

test('허용: 파일 글롭이 맞고 rule 이 0 이거나 같은 번호면 뺀다', async () => {
  const found = [{ file: 'tests/a.mjs', number: 2 }, { file: 'tests/a.mjs', number: 4 }, { file: 'src/a.mjs', number: 2 }]
  assert.deepEqual(dropAllowed(found, [{ file: 'tests/**', rule: 2, reason: '가짜 값' }]), [found[1], found[2]])
  assert.deepEqual(dropAllowed(found, [{ file: 'tests/**', rule: 0, reason: '가짜 값' }]), [found[2]])
  const dir = publicProject({ 'tests/a.txt': WORD }, { allow: [{ file: 'tests/**', reason: '테스트 자료' }] })
  const result = await withDenylist(denylistFile(), () => callCheck(run, 'exposure', dir))
  assert.equal(result.status, 'pass')
  assert.equal(result.metrics.allowed, 1)
})

test('공개 저장소인데 목록이 없으면 설정 오류(종료 코드 2)다', async () => {
  const dir = publicProject({ 'a.txt': 'a\n' })
  const { code, output } = await withoutDenylist(() => gate(dir, ['--no-evidence', '--only', 'exposure']))
  assert.equal(code, 2)
  assert.match(output, /설정 오류\n {2}checks\.exposure: 공개 저장소인데 금지어 목록이 없다/)
})

test('목록의 줄이 틀렸거나 규칙이 하나도 없어도 설정 오류다', async () => {
  const dir = publicProject({ 'a.txt': 'a\n' })
  const broken = await withDenylist(denylistFile('ok\n(broken\n'), () => gate(dir, ['--no-evidence', '--only', 'exposure']))
  assert.equal(broken.code, 2)
  assert.match(broken.output, /금지어 목록의 2번 줄을 정규식으로 읽을 수 없다/)
  const empty = await withDenylist(denylistFile('# 주석만 있다\n'), () => gate(dir, ['--no-evidence', '--only', 'exposure']))
  assert.equal(empty.code, 2)
  assert.match(empty.output, /규칙이 하나도 없다/)
})

test('비공개 저장소는 기본으로 돌지 않고, 켰는데 목록이 없으면 건너뛴다', async () => {
  const dir = makeProject({}, { 'a.txt': WORD })
  const byDefault = await withoutDenylist(() => gate(dir, ['--no-evidence', '--only', 'exposure']))
  assert.match(byDefault.output, /- exposure\s+off/)
  const enabled = makeProject({ checks: { exposure: { mode: 'fail' } } }, { 'a.txt': WORD })
  const result = await withoutDenylist(() => callCheck(run, 'exposure', enabled, { mode: 'fail' }))
  assert.equal(result.status, 'skip')
  const withList = await withDenylist(denylistFile(), () => gate(enabled, ['--no-evidence', '--only', 'exposure']))
  assert.equal(withList.code, 1)
})

test('full 프로필은 태그를 단 사람 · 태그 메시지 · 태그 이름 · 브랜치 이름도 본다', async () => {
  const dir = publicProject({ 'a.txt': 'a\n' })
  commitAll(dir)
  git(dir, '-c', `user.email=dev@${WORD}.test`, 'tag', '-a', 'v1.0.0', '-m', 'release')
  git(dir, 'tag', '-a', 'v1.1.0', '-m', `built for ${WORD}`)
  git(dir, 'tag', `${WORD}-rc`)
  git(dir, 'branch', `${WORD}/topic`)
  const full = await withDenylist(denylistFile(), () => callCheck(run, 'exposure', dir, { profile: 'full' }))
  assert.deepEqual(full.findings.map((found) => found.file).sort(), [
    `(ref) refs/heads/${WORD}/topic`,
    '(ref) refs/tags/v1.0.0',
    '(ref) refs/tags/v1.1.0',
    `(ref) refs/tags/${WORD}-rc`,
  ])
  const light = await withDenylist(denylistFile(), () => callCheck(run, 'exposure', dir))
  assert.equal(light.status, 'pass', 'light 프로필은 이력과 ref 를 보지 않는다')
})
