// 문서의 주장 찾기와 판정 — 문서에서 pattern 이 맞은 곳의 값을 뽑고, 코드에서 센 값과 견준다. 모두 순수 함수다.
// 부르는 곳: run.mjs.
// 먼저 읽을 파일: sources.mjs(견줄 값이 오는 곳).
import { splitLines } from '../../lib/platform.mjs'

const ARROW_BEFORE = /(?:→|->|=>)\s*\**\s*$/
const ARROW_AFTER = /^\s*\**\s*(?:→|->|=>)/
const ARROW_INSIDE = /→|->|=>/
const CONTEXT_CHARS = 12

/** 「73→112」처럼 화살표 앞뒤에 있는 값은 바뀐 이력을 적은 것이라 지금 값의 주장이 아니다. */
export function isHistoryNote(lineText, matchIndex, matchLength) {
  const before = lineText.slice(Math.max(0, matchIndex - CONTEXT_CHARS), matchIndex)
  const after = lineText.slice(matchIndex + matchLength, matchIndex + matchLength + CONTEXT_CHARS)
  const inside = lineText.slice(matchIndex, matchIndex + matchLength)
  return ARROW_BEFORE.test(before) || ARROW_AFTER.test(after) || ARROW_INSIDE.test(inside)
}

/** 문서에서 pattern 이 맞은 곳을 [{ line, stated, isHistory }] 로 돌려준다. 값은 첫 묶음, 묶음이 없으면 맞은 글자 전체다. */
export function findClaims(docText, patternSource) {
  const pattern = new RegExp(patternSource, 'g')
  return splitLines(docText).flatMap((lineText, index) =>
    [...lineText.matchAll(pattern)].map((match) => ({
      line: index + 1,
      stated: match[1] ?? match[0],
      isHistory: isHistoryNote(lineText, match.index, match[0].length),
    })),
  )
}

// 「1,234개」처럼 자릿수 쉼표를 넣은 숫자는 쉼표를 빼고 견준다.
const normalize = (stated) => (/^\d{1,3}(,\d{3})+$/.test(stated) ? stated.replaceAll(',', '') : stated)

/**
 * 사실 하나의 판정. claims 는 findClaims 의 결과, actual 은 코드에서 센 값(문자열)이다.
 * 한 번도 맞지 않으면 찾은 것으로 낸다. 문구가 바뀌어 검사가 조용히 꺼지는 일을 막기 위해서다.
 */
export function judgeFact(claims, actual) {
  if (claims.length === 0) return [{ rule: 'pattern-not-found', line: null }]
  return claims
    .filter((claim) => !claim.isHistory && normalize(claim.stated) !== actual)
    .map((claim) => ({ rule: 'mismatch', line: claim.line, stated: claim.stated, actual }))
}
