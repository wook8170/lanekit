// 마크다운 줄 고르기 — 문서에서 산문 줄과 제목만 골라낸다. 코드 블록 · 인라인 코드 · 인용문은 뺀다.
// 부르는 곳: checks/guidance(자기 규칙 위반 · 겹치는 제목), checks/writing(글쓰기 규칙).
// 먼저 읽을 파일: checks/guidance/rules.mjs(쓰는 예).
import { splitLines } from './platform.mjs'

const FENCE = /^\s*(```|~~~)/
const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/
const HANGUL = /[가-힣]/

/** 코드 블록 밖의 줄을 [{ line, text }] 로 돌려준다. line 은 1 부터 센다. */
function linesOutsideFences(source) {
  const kept = []
  let openFence = null
  splitLines(source).forEach((text, index) => {
    const marker = text.match(FENCE)?.[1]
    if (marker && (openFence === null || marker === openFence)) {
      openFence = openFence === null ? marker : null
    } else if (openFence === null) {
      kept.push({ line: index + 1, text })
    }
  })
  return kept
}

/** 산문 줄. 인용문은 빼고, 줄 안의 인라인 코드는 지운다(표의 코드 칸도 이때 지워진다). */
export function proseLines(source) {
  return linesOutsideFences(source)
    .filter((entry) => !/^\s*>/.test(entry.text))
    .map((entry) => ({ line: entry.line, text: entry.text.replace(/`[^`]*`/g, '') }))
}

/** 제목 줄 [{ line, title }]. title 은 # 을 뗀 글자다. */
export function headings(source) {
  return linesOutsideFences(source)
    .map((entry) => ({ line: entry.line, title: entry.text.match(HEADING)?.[1] }))
    .filter((entry) => entry.title)
}

export const hasHangul = (text) => HANGUL.test(text)
