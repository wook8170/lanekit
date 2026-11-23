// 글쓰기 검사 테스트(영어) — 영어 규칙 두 가지의 나쁜 예 · 좋은 예와 영어 메시지를 본다.
// 대상: kit/checks/writing/rules-en.mjs · run.mjs.
// 먼저 읽을 파일: writing-ko.test.mjs(같은 검사의 한국어 쪽).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RULES_EN } from '../kit/checks/writing/rules-en.mjs'
import { run } from '../kit/checks/writing/run.mjs'
import { scanDocument } from '../kit/checks/writing/scan.mjs'
import { callCheck } from './check-helpers.mjs'
import { makeProject } from './helpers.mjs'

const scan = (text) => scanDocument(text, { korean: {}, english: RULES_EN, extra: {} }, []).map((found) => `${found.rule}:${found.text}`)

const PAIRS = {
  hype: [
    ['A seamless and robust experience.', ['hype:seamless', 'hype:robust'], 'Sign-in needs no second step and survives a dropped connection.'],
    ['This is a Game-Changer.', ['hype:Game-Changer'], 'Build time dropped from 90 to 20 seconds.'],
    ['Blazingly fast, state-of-the-art search.', ['hype:Blazingly fast', 'hype:state-of-the-art'], 'Search returns in 20 ms using BM25.'],
  ],
  'ai-trace': [
    ["Let's dive into the config.", ["ai-trace:Let's dive"], 'The config has three sections.'],
    ['In conclusion, it works.', ['ai-trace:In conclusion'], 'It works.'],
    ["It's worth noting that I hope this helps.", ["ai-trace:It's worth noting", 'ai-trace:I hope this helps'], 'The cache is cleared on restart.'],
  ],
}

for (const [rule, cases] of Object.entries(PAIRS)) {
  test(`${rule}: bad examples are caught and good examples pass`, () => {
    for (const [bad, caught, good] of cases) {
      assert.deepEqual(scan(bad), caught)
      assert.deepEqual(scan(good), [])
    }
  })
}

test('낱말의 일부로 들어간 글자는 잡지 않는다', () => {
  assert.deepEqual(scan('The robustness score and the delved data.'), [])
})

test('코드 블록 안은 보지 않는다', () => {
  assert.deepEqual(scan('```\nseamless\n```\n`robust`\n'), [])
})

test('영어 설정이면 문장이 영어다', async () => {
  const dir = makeProject({ lang: 'en' }, { 'README.md': 'A robust tool.\n' })
  const result = await callCheck(run, 'writing', dir)
  assert.equal(result.findings[0].message, '"robust" → say which failures it handles')
  assert.equal(result.summary, '1 documents · 1 banned expressions · 0 noun chains (warning only)')
})
