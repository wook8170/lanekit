// 글쓰기 규칙 적용 — 문서 하나의 산문 줄에서 금지 표현과 명사 사슬을 찾는다. 모두 순수 함수다.
// 부르는 곳: run.mjs(문서마다 한 번).
// 먼저 읽을 파일: rules-ko.mjs · rules-en.mjs(표현 목록), ../../lib/markdown.mjs(산문 줄 고르기).
import { hasHangul, proseLines } from '../../lib/markdown.mjs'

export const NOUN_CHAIN = 'noun-chain'
const NOUN_CHAIN_MIN_WORDS = 4

// 조사나 서술 어미로 끝나는 낱말은 사슬을 끊는다. 틀리게 잡는 일을 줄이려고 끊는 쪽으로 넓게 잡았다.
const ENDS_WITH_PARTICLE = /[은는이가을를의에로와과도만서며고면다]$/
const HANGUL_WORD = /^[가-힣]{2,}$/

const isChainWord = (word) => HANGUL_WORD.test(word) && !ENDS_WITH_PARTICLE.test(word)

/** 조사 없이 이어진 한글 낱말이 4개 이상인 곳을 [{ text }] 로 돌려준다. */
export function findNounChains(lineText) {
  const chains = []
  let chain = []
  const close = () => {
    if (chain.length >= NOUN_CHAIN_MIN_WORDS) chains.push({ text: chain.join(' ') })
    chain = []
  }
  for (const word of lineText.split(/\s+/)) {
    if (isChainWord(word)) chain.push(word)
    else close()
  }
  close()
  return chains
}

/** 줄 안에서 허용 구절이 차지하는 구간 [{ start, end }]. */
function allowedSpans(lineText, allowPhrases) {
  const spans = []
  for (const phrase of allowPhrases.filter(Boolean)) {
    let start = lineText.indexOf(phrase)
    while (start !== -1) {
      spans.push({ start, end: start + phrase.length })
      start = lineText.indexOf(phrase, start + 1)
    }
  }
  return spans
}

function findExpressions(lineText, rule, expressions, flags) {
  return expressions.flatMap((expression) =>
    [...lineText.matchAll(new RegExp(expression.pattern, flags))].map((match) => ({
      rule,
      text: match[0],
      suggest: expression.suggest ?? '',
      start: match.index,
      end: match.index + match[0].length,
    })),
  )
}

/** 설정의 extraBanned([{ rule, pattern }])를 규칙 표 { 규칙: [{ pattern }] } 로 바꾼다. */
export function groupExtraBanned(extraBanned) {
  const grouped = {}
  for (const extra of extraBanned) (grouped[extra.rule] ??= []).push({ pattern: extra.pattern })
  return grouped
}

/** 줄 하나에 걸리는 금지 표현. 한국어 규칙은 한글이 있는 줄에만, 영어 규칙은 대소문자를 가리지 않고 적용한다. */
function findBanned(lineText, ruleSets, isKorean) {
  const apply = (rules, flags) => Object.entries(rules).flatMap(([rule, list]) => findExpressions(lineText, rule, list, flags))
  return [...(isKorean ? apply(ruleSets.korean, 'g') : []), ...apply(ruleSets.english, 'gi'), ...apply(ruleSets.extra, 'g')]
}

function scanLine(entry, ruleSets, allowPhrases) {
  const isKorean = hasHangul(entry.text)
  const spans = allowedSpans(entry.text, allowPhrases)
  const isAllowed = (match) => spans.some((span) => span.start <= match.start && match.end <= span.end)
  const banned = findBanned(entry.text, ruleSets, isKorean).filter((match) => !isAllowed(match))
  const chains = (isKorean ? findNounChains(entry.text) : [])
    .filter((chain) => !allowPhrases.includes(chain.text))
    .map((chain) => ({ rule: NOUN_CHAIN, text: chain.text, suggest: '' }))
  return [...banned, ...chains].map((match) => ({ line: entry.line, rule: match.rule, text: match.text, suggest: match.suggest }))
}

/**
 * 문서 하나에서 찾은 것 [{ line, rule, text, suggest }].
 * ruleSets 는 { korean, english, extra } 이고 값은 모두 { 규칙: [{ pattern, suggest }] } 다.
 * 한국어 규칙과 명사 사슬은 한글이 있는 줄에만 적용한다.
 */
export function scanDocument(docText, ruleSets, allowPhrases) {
  return proseLines(docText).flatMap((entry) => scanLine(entry, ruleSets, allowPhrases))
}
