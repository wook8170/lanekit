// 지침 예산의 규칙 네 가지 — 지침 파일의 크기 · 겹치는 절 · 머신에 묶인 경로 · 자기 글쓰기 규칙 위반을 찾는다. 모두 순수 함수다.
// 부르는 곳: run.mjs(게이트의 guidance 검사), 플러그인 쪽 doctor 의 지침 점검.
// 먼저 읽을 파일: run.mjs(읽은 문서를 이 규칙들에 넘기는 곳).
import { hasHangul, headings, proseLines } from '../../lib/markdown.mjs'
import { splitLines } from '../../lib/platform.mjs'

export const RULE_NAMES = ['size', 'duplicate-heading', 'absolute-path', 'self-violation']

// 문서는 { file, text, bytes } 다. 찾은 것은 { file, line, rule, value, limit, amount, messageKey, vars } 로 돌려준다.
// amount 는 기준선에 더할 양이다. 크기 규칙은 넘은 만큼, 나머지 규칙은 한 건에 1 이다.

const MACHINE_BOUND = /\/(?:Users|Volumes)\/[^\s`'")\]]*|[A-Za-z]:\\[^\s`'")\]]*|localhost:\d{2,5}/g

const countLines = (text) => (text === '' ? 0 : text.replace(/\n$/, '').split('\n').length)
const normalizeTitle = (title) => title.toLowerCase().replace(/\s+/g, ' ').trim()

function oversize(doc, measured, limit, unit) {
  if (limit === undefined || measured <= limit) return []
  const messageKey = `guidance.size.${unit}`
  return [{ file: doc.file, line: null, rule: 'size', value: measured, limit, amount: measured - limit, messageKey, vars: {} }]
}

/** size — 줄 수 상한(maxLines)과 바이트 상한(maxBytes)을 넘은 지침 파일. */
export function findOversize(doc, { maxLines, maxBytes }) {
  return [
    ...oversize(doc, countLines(doc.text), maxLines[doc.file], 'lines'),
    ...oversize(doc, doc.bytes, maxBytes[doc.file], 'bytes'),
  ]
}

/** duplicate-heading — 앞에 나온 다른 지침 파일에 이미 있는 제목. 뒤 파일의 줄로 알린다. */
export function findDuplicateHeadings(docs) {
  const firstOwner = new Map()
  const found = []
  for (const doc of docs) {
    const ownTitles = headings(doc.text).map((heading) => ({ ...heading, key: normalizeTitle(heading.title) }))
    for (const heading of ownTitles) {
      const other = firstOwner.get(heading.key)
      if (!other) continue
      const vars = { title: heading.title, other }
      found.push({ file: doc.file, line: heading.line, rule: 'duplicate-heading', value: 1, limit: 0, amount: 1, messageKey: 'guidance.duplicate-heading', vars })
    }
    for (const heading of ownTitles) if (!firstOwner.has(heading.key)) firstOwner.set(heading.key, doc.file)
  }
  return found
}

/** absolute-path — 사용자 폴더 · 볼륨 · 드라이브로 시작하는 경로와 localhost:<포트>. 코드 블록 안도 본다. */
export function findMachineBoundPaths(doc) {
  return splitLines(doc.text).flatMap((text, index) =>
    [...text.matchAll(MACHINE_BOUND)].map((match) => ({
      file: doc.file,
      line: index + 1,
      rule: 'absolute-path',
      value: 1,
      limit: 0,
      amount: 1,
      messageKey: 'guidance.absolute-path',
      vars: { match: match[0] },
    })),
  )
}

/** self-violation — 지침의 산문 줄이 글쓰기 규칙의 표현(expressions: [{ pattern, suggest }])에 걸리는 곳. */
export function findSelfViolations(doc, expressions) {
  const koreanLines = proseLines(doc.text).filter((entry) => hasHangul(entry.text))
  return koreanLines.flatMap((entry) =>
    expressions.flatMap((expression) =>
      [...entry.text.matchAll(new RegExp(expression.pattern, 'g'))].map((match) => ({
        file: doc.file,
        line: entry.line,
        rule: 'self-violation',
        value: 1,
        limit: 0,
        amount: 1,
        messageKey: 'guidance.self-violation',
        vars: { match: match[0], suggest: expression.suggest },
      })),
    ),
  )
}
