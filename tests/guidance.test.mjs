// 지침 예산 검사 테스트 — 규칙 네 가지가 가상 프로젝트에서 잡히는지, 깨끗한 지침은 통과하는지 본다.
// 대상: kit/checks/guidance/ · kit/lib/markdown.mjs · kit/checks/writing/rules-ko.mjs.
// 먼저 읽을 파일: fixtures/acme-app/README.md(넣어 둔 위반의 목록).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { findDuplicateHeadings, findMachineBoundPaths, findOversize, findSelfViolations } from '../kit/checks/guidance/rules.mjs'
import { run } from '../kit/checks/guidance/run.mjs'
import { RULES_KO } from '../kit/checks/writing/rules-ko.mjs'
import { validateConfig } from '../kit/lib/config.mjs'
import { headings, proseLines } from '../kit/lib/markdown.mjs'
import { createKitTranslator } from '../kit/lib/messages.mjs'
import { copyFixture, FIXTURE_DIR, gate, makeProject, readJson, writeFiles } from './helpers.mjs'

const GUIDANCE_DIR = fileURLToPath(new URL('../kit/checks/guidance', import.meta.url))
const doc = (file, text) => ({ file, text, bytes: Buffer.byteLength(text) })

function runOn(root, lang = 'ko') {
  const { config } = validateConfig(readJson(join(root, 'lanekit.config.json')))
  return run({ root, config, mode: 'warn', profile: 'light', changedFiles: null, baseline: null, git: null, t: createKitTranslator(lang, [GUIDANCE_DIR]) })
}

test('가상 프로젝트에서 규칙 네 가지를 모두 잡는다', async () => {
  const result = await runOn(FIXTURE_DIR)
  assert.equal(result.status, 'findings')
  assert.deepEqual(result.metrics, { size: 2, 'duplicate-heading': 1, 'absolute-path': 3, 'self-violation': 2 })
  const places = result.findings.map((found) => `${found.rule} ${found.file}:${found.line ?? '-'}`)
  assert.deepEqual(places, [
    'size CLAUDE.md:-',
    'size AGENTS.md:-',
    'duplicate-heading AGENTS.md:8',
    'absolute-path AGENTS.md:25',
    'absolute-path AGENTS.md:26',
    'absolute-path AGENTS.md:27',
    'self-violation AGENTS.md:21',
    'self-violation AGENTS.md:21',
  ])
})

test('찾은 것의 문장과 기준선에 견줄 값', async () => {
  const result = await runOn(FIXTURE_DIR)
  const messageOf = (rule, index = 0) => result.findings.filter((found) => found.rule === rule)[index].message
  assert.equal(messageOf('size'), '11줄이다. 상한은 6줄이다')
  assert.match(messageOf('size', 1), /^\d+바이트다\. 상한은 600바이트다$/)
  assert.equal(messageOf('duplicate-heading'), '「게이트」 절이 CLAUDE.md 에도 있다. 한 곳에만 둔다')
  assert.match(messageOf('absolute-path', 1), /localhost:3000/)
  assert.equal(messageOf('self-violation'), '지침이 자기 글쓰기 규칙을 어긴다: 「단위 시험」 → 단위 테스트')
  assert.equal(messageOf('self-violation', 1), '지침이 자기 글쓰기 규칙을 어긴다: 「기능 가지에서」 → 브랜치')
  assert.deepEqual(result.current['duplicate-heading'], { 'AGENTS.md': 1 })
  assert.deepEqual(result.current['absolute-path'], { 'AGENTS.md': 3 })
  assert.deepEqual(result.current['self-violation'], { 'AGENTS.md': 2 })
  assert.equal(result.current.size['CLAUDE.md'], 5, '크기 규칙의 값은 상한을 넘은 만큼이다')
  assert.ok(result.current.size['AGENTS.md'] > 0)
})

test('영어 설정이면 문장이 영어다', async () => {
  const result = await runOn(FIXTURE_DIR, 'en')
  assert.equal(result.findings[0].message, '11 lines. The limit is 6')
})

const CLEAN_FILES = {
  'CLAUDE.md': '# acme-app\n\n`AGENTS.md` 를 먼저 읽는다.\n',
  'AGENTS.md': '# 작업 지침\n\n## 테스트\n\n기능을 바꾸면 단위 테스트를 같은 변경에서 고친다. 기능 브랜치에서 작업한다.\n',
}

test('깨끗한 지침은 통과하고, 규칙 네 가지가 빈 칸으로 남는다', async () => {
  const result = await runOn(makeProject({}, CLEAN_FILES))
  assert.equal(result.status, 'pass')
  assert.deepEqual(result.findings, [])
  assert.deepEqual(result.current, { size: {}, 'duplicate-heading': {}, 'absolute-path': {}, 'self-violation': {} })
})

test('지침 파일이 하나도 없으면 건너뛴다', async () => {
  const result = await runOn(makeProject({}))
  assert.equal(result.status, 'skip')
  assert.equal(result.summary, '지침 파일이 없다')
})

test('size — 줄 수와 바이트 상한을 따로 본다. 상한과 같으면 통과다', () => {
  const limits = { maxLines: { 'CLAUDE.md': 3 }, maxBytes: { 'CLAUDE.md': 10 } }
  assert.deepEqual(findOversize(doc('CLAUDE.md', 'a\nb\nc\n'), limits), [])
  const found = findOversize(doc('CLAUDE.md', 'aaaa\nbbbb\ncccc\ndddd\n'), limits)
  assert.deepEqual(found.map((entry) => [entry.messageKey, entry.value, entry.limit, entry.amount]), [
    ['guidance.size.lines', 4, 3, 1],
    ['guidance.size.bytes', 20, 10, 10],
  ])
  assert.deepEqual(findOversize(doc('OTHER.md', 'a\n'.repeat(99)), limits), [], '상한을 적지 않은 파일은 보지 않는다')
})

test('duplicate-heading — 다른 파일과 겹치는 제목만 잡는다', () => {
  const first = doc('CLAUDE.md', '# 지침\n\n## Git 규칙\n\n## Git 규칙\n')
  const second = doc('AGENTS.md', '# 다른 제목\n\n```\n## Git 규칙\n```\n\n##  git  규칙 ##\n')
  const found = findDuplicateHeadings([first, second])
  assert.deepEqual(found.map((entry) => [entry.file, entry.line, entry.vars.other]), [['AGENTS.md', 7, 'CLAUDE.md']])
})

test('absolute-path — 사용자 폴더 · 볼륨 · 드라이브 · localhost 포트를 잡는다', () => {
  const text = ['저장소는 /Users/alex/acme 에 둔다', '상대 경로 docs/Users/guide.md 는 괜찮다', '```', 'cd /Volumes/data/acme', '```', 'http://localhost:8080/health', 'localhost 만 적으면 괜찮다', 'D:\\work\\acme'].join('\n')
  const found = findMachineBoundPaths(doc('AGENTS.md', text))
  assert.deepEqual(found.map((entry) => [entry.line, entry.vars.match]), [
    [1, '/Users/alex/acme'],
    [2, '/Users/guide.md'],
    [4, '/Volumes/data/acme'],
    [6, 'localhost:8080'],
    [8, 'D:\\work\\acme'],
  ])
})

test('self-violation — 코드 블록 · 인라인 코드 · 인용문은 보지 않는다', () => {
  const text = ['단위 시험을 고친다', '`단위 시험`은 코드다', '> 단위 시험 인용', '```', '단위 시험', '```', '다음 판에 넣는다. 다음 판단은 미룬다', 'unit 시험 케이스'].join('\n')
  const found = findSelfViolations(doc('AGENTS.md', text), RULES_KO['forced-translation'])
  assert.deepEqual(found.map((entry) => [entry.line, entry.vars.match]), [[1, '단위 시험'], [7, '다음 판에'], [8, '시험 케이스']])
})

test('억지로 옮긴 용어의 목록 — 잡는 예와 잡지 않는 예', () => {
  const matches = (text) => RULES_KO['forced-translation'].some((expression) => new RegExp(expression.pattern).test(text))
  for (const bad of ['종단 시험을 더한다', '시험을 돌린다', '기능 가지에서 작업한다', '가지를 따서 고친다', '판 올림 절차', '이번 판은 여기까지', '끌어오기 요청을 연다']) {
    assert.ok(matches(bad), bad)
  }
  for (const good of ['단위 테스트를 고친다', '시험 삼아 돌려 본다', '여러 가지 방법이 있다', '이번 판단은 옳았다', '재판 결과', '기능 브랜치']) {
    assert.ok(!matches(good), good)
  }
})

test('markdown — 코드 블록 밖의 줄과 제목만 고른다', () => {
  const text = ['# 제목', '본문 `code` 끝', '~~~js', '# 코드 안', '~~~', '> 인용', '## 둘째 ##'].join('\n')
  assert.deepEqual(proseLines(text), [{ line: 1, text: '# 제목' }, { line: 2, text: '본문  끝' }, { line: 7, text: '## 둘째 ##' }])
  assert.deepEqual(headings(text), [{ line: 1, title: '제목' }, { line: 7, title: '둘째' }])
})

test('게이트로 돌리면 warn 은 통과, fail 은 실패다', async () => {
  const dir = copyFixture()
  const warned = await gate(dir, ['--only', 'guidance', '--no-evidence'])
  assert.equal(warned.code, 0)
  assert.match(warned.output, /guidance\s+warn\s+통과\s+지침 파일 2개 · 찾은 것 8건 \(경고만 낸다\)/)
  assert.match(warned.output, /AGENTS\.md:26 \[absolute-path\]/)
  const config = readJson(join(dir, 'lanekit.config.json'))
  config.checks.guidance.mode = 'fail'
  writeFiles(dir, { 'lanekit.config.json': config })
  assert.equal((await gate(dir, ['--only', 'guidance', '--no-evidence'])).code, 1)
})

test('기준선을 잠근 뒤에는 위반이 늘 때만 실패한다', async () => {
  const dir = copyFixture()
  assert.equal((await gate(dir, ['--relock', 'guidance', '--reason', 'init'])).code, 0)
  const config = readJson(join(dir, 'lanekit.config.json'))
  config.checks.guidance.mode = 'ratchet'
  writeFiles(dir, { 'lanekit.config.json': config })
  assert.equal((await gate(dir, ['--only', 'guidance', '--no-evidence'])).code, 0)

  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
  writeFiles(dir, { 'AGENTS.md': `${agents}- 스테이징은 localhost:4000 이다.\n` })
  const grown = await gate(dir, ['--only', 'guidance', '--no-evidence'])
  assert.equal(grown.code, 1)
  assert.match(grown.output, /\+ \[absolute-path\] AGENTS\.md 3 -> 4/)
})
