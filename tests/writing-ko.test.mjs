// 글쓰기 검사 테스트(한국어) — 규칙 여섯 가지의 나쁜 예 · 좋은 예, 건너뛰는 줄, 허용과 추가, 래칫을 본다.
// 대상: kit/checks/writing/run.mjs · scan.mjs · rules-ko.mjs.
// 먼저 읽을 파일: ../kit/checks/writing/scan.mjs(규칙을 줄에 적용하는 곳).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RULES_EN } from '../kit/checks/writing/rules-en.mjs'
import { RULES_KO } from '../kit/checks/writing/rules-ko.mjs'
import { run } from '../kit/checks/writing/run.mjs'
import { findNounChains, scanDocument } from '../kit/checks/writing/scan.mjs'
import { callCheck, rulesOf } from './check-helpers.mjs'
import { commitAll, gate, makeProject, writeFiles } from './helpers.mjs'

const RULE_SETS = { korean: RULES_KO, english: RULES_EN, extra: {} }
const scan = (text, allow = []) => scanDocument(text, RULE_SETS, allow).map((found) => `${found.rule}:${found.text}`)

// 규칙마다 [나쁜 예, 잡히는 글자, 좋은 예] 다.
const PAIRS = {
  hype: ['강력한 검색 기능을 제공한다.', '강력한', '검색어를 넣으면 0.2초 안에 결과를 돌려준다.'],
  metaphor: ['이 모듈은 시스템의 심장이다.', '심장', '이 모듈이 모든 요청의 권한을 확인한다.'],
  'ai-trace': ['이제 구조를 살펴보겠습니다.', '살펴보겠습니다', '구조는 세 층이다.'],
  'forced-translation': ['단위 시험을 먼저 쓴다.', '단위 시험', '단위 테스트를 먼저 쓴다.'],
  personification: ['함수가 오류를 삼킨다.', '를 삼킨다', '함수가 오류를 잡고 기록하지 않는다.'],
  'noun-chain': ['사용자 권한 기반 데이터 접근 통제 구조.', '사용자 권한 기반 데이터 접근 통제', '사용자 권한에 따라 볼 수 있는 데이터를 제한한다.'],
}

for (const [rule, [bad, caught, good]] of Object.entries(PAIRS)) {
  test(`${rule}: 나쁜 예는 잡고 좋은 예는 지나간다`, () => {
    assert.deepEqual(scan(bad), [`${rule}:${caught}`])
    assert.deepEqual(scan(good), [])
  })
}

test('코드 블록 · 인라인 코드 · 표의 코드 칸 · 인용문은 보지 않는다', () => {
  const doc = ['```', '강력한 기능', '```', '`혁신적인` 이라는 낱말', '| 이름 | `획기적인` |', '> 결론적으로 강력한 기능이다.', '강력한 기능이다.'].join('\n')
  assert.deepEqual(scanDocument(doc, RULE_SETS, []).map((found) => [found.line, found.rule]), [[7, 'hype']])
})

test('한글이 없는 줄에는 한국어 규칙을 적용하지 않고, 영어 규칙은 한글 줄에도 적용한다', () => {
  assert.deepEqual(scan('심장 is not flagged without hangul? no: 심장'), ['metaphor:심장', 'metaphor:심장'])
  assert.deepEqual(scan('A robust parser.'), ['hype:robust'])
  assert.deepEqual(scan('이 파서는 robust 하다.'), ['hype:robust'])
})

test('기술 용어로 쓰는 낱말은 비유로 잡지 않는다', () => {
  assert.deepEqual(scan('검색 엔진과 신경망 모델, 허브 저장소를 쓴다.'), [])
})

test('명사 사슬: 조사로 끝나는 낱말과 한 글자 낱말에서 끊긴다', () => {
  assert.deepEqual(findNounChains('공포 영화 배경음악 생성 도구'), [{ text: '공포 영화 배경음악 생성 도구' }])
  assert.deepEqual(findNounChains('공포 영화에 쓸 배경음악을 만드는 도구'), [])
  assert.deepEqual(findNounChains('설정 파일 경로 세 개'), [])
})

test('allow 는 그 구절 안의 표현만 빼고, extraBanned 는 규칙을 더한다', async () => {
  const config = { checks: { writing: { allow: ['심장 박동'], extraBanned: [{ rule: 'house', pattern: '고객님' }] } } }
  const dir = makeProject(config, { 'docs/a.md': '심장 박동을 잰다.\n시스템의 심장이다.\n고객님께 알린다.\n' })
  const result = await callCheck(run, 'writing', dir)
  assert.deepEqual(result.findings.map((found) => [found.line, found.rule]), [[2, 'metaphor'], [3, 'house']])
  assert.deepEqual(result.current.house, { 'docs/a.md': 1 })
})

test('run: 기준선에 견줄 값은 「규칙 × 파일」이고 명사 사슬은 넣지 않는다', async () => {
  const dir = makeProject({}, {
    'docs/a.md': `${PAIRS.hype[0]}\n${PAIRS.hype[0]}\n${PAIRS['noun-chain'][0]}\n`,
    'README.md': `${PAIRS['ai-trace'][0]}\n`,
    'notes/skip.md': `${PAIRS.hype[0]}\n`,
  })
  const result = await callCheck(run, 'writing', dir)
  assert.equal(result.status, 'findings')
  assert.deepEqual(result.current.hype, { 'docs/a.md': 2 })
  assert.deepEqual(result.current['ai-trace'], { 'README.md': 1 })
  assert.deepEqual(result.current.metaphor, {}, '찾은 것이 없는 규칙도 빈 칸으로 낸다')
  assert.equal(result.current['noun-chain'], undefined)
  assert.equal(result.metrics['noun-chain'], 1)
  assert.equal(result.findings[1].message, '「강력한」 → 무엇을 할 수 있는지 적는다')
  assert.deepEqual(rulesOf(result), ['ai-trace', 'hype', 'hype', 'noun-chain'])
})

test('명사 사슬은 warn 모드에서만 찾은 것으로 낸다. fail 모드는 명사 사슬만으로 실패하지 않는다', async () => {
  const dir = makeProject({ checks: { writing: { mode: 'fail' } } }, { 'docs/a.md': `${PAIRS['noun-chain'][0]}\n` })
  const result = await callCheck(run, 'writing', dir, { mode: 'fail' })
  assert.equal(result.status, 'pass')
  assert.equal(result.metrics['noun-chain'], 1)
  assert.equal((await gate(dir, ['--only', 'writing', '--no-evidence'])).code, 0)
})

test('문서가 없으면 건너뛴다', async () => {
  const result = await callCheck(run, 'writing', makeProject({}, { 'src/a.mjs': '' }))
  assert.equal(result.status, 'skip')
})

test('게이트: 잠근 뒤 ratchet 모드에서 같은 수는 통과하고 늘면 실패한다', async () => {
  const dir = makeProject({ checks: { writing: { mode: 'warn' } } }, { 'docs/a.md': `${PAIRS.hype[0]}\n` })
  commitAll(dir)
  assert.equal((await gate(dir, ['--relock', 'writing', '--reason', '처음 잠금'])).code, 0)
  writeFiles(dir, { 'lanekit.config.json': { checks: { writing: { mode: 'ratchet' } } } })
  assert.equal((await gate(dir, ['--only', 'writing', '--no-evidence'])).code, 0)
  writeFiles(dir, { 'docs/a.md': `${PAIRS.hype[0]}\n${PAIRS.metaphor[0]}\n` })
  const grown = await gate(dir, ['--only', 'writing', '--no-evidence'])
  assert.equal(grown.code, 1)
  assert.match(grown.output, /\+ \[metaphor\] docs\/a\.md 0 -> 1/)
})
