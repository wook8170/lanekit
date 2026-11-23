// 글쓰기 검사(writing) — 문서의 산문 줄에서 기계로 확실히 잡을 수 있는 표현만 찾는다. 래칫의 칸은 「규칙 × 파일」이다.
// 부르는 곳: gate.mjs(등록표의 writing).
// 먼저 읽을 파일: scan.mjs(규칙을 줄에 적용하는 곳) → rules-ko.mjs · rules-en.mjs(표현 목록).
import { listWorkFiles, readTextFile } from '../../lib/files.mjs'
import { filterByGlobs } from '../../lib/glob.mjs'
import { RULES_EN } from './rules-en.mjs'
import { RULES_KO } from './rules-ko.mjs'
import { groupExtraBanned, NOUN_CHAIN, scanDocument } from './scan.mjs'

export const meta = {
  id: 'writing',
  profiles: ['light', 'changed', 'full'],
  defaultMode: 'warn',
  ratchetable: true,
}

function scanDocs(ctx, options) {
  const ruleSets = { korean: RULES_KO, english: RULES_EN, extra: groupExtraBanned(options.extraBanned) }
  const docs = filterByGlobs(listWorkFiles(ctx.root, ctx.git), options.globs)
  const matches = docs.flatMap((file) => {
    const text = readTextFile(ctx.root, file)
    return text === null ? [] : scanDocument(text, ruleSets, options.allow).map((match) => ({ ...match, file }))
  })
  return { docs, matches, ruleNames: [...new Set([...Object.keys(RULES_KO), ...Object.keys(RULES_EN), ...Object.keys(ruleSets.extra)])] }
}

/** 기준선과 견줄 값. 명사 사슬은 틀리게 잡는 일이 많아 기준선에 넣지 않는다. */
function tallyByRuleAndFile(matches, ruleNames) {
  const current = Object.fromEntries(ruleNames.map((rule) => [rule, {}]))
  for (const match of matches) current[match.rule][match.file] = (current[match.rule][match.file] ?? 0) + 1
  return current
}

const toFinding = (match, translate) => ({
  file: match.file,
  line: match.line,
  rule: match.rule,
  message: translate(match.suggest ? 'writing.found-with-suggest' : 'writing.found', { text: match.text, suggest: match.suggest }),
  value: 1,
  limit: 0,
})

/** 검사 계약의 run. 명사 사슬은 warn 모드에서만 찾은 것으로 내고, 그 밖의 모드에서는 건수만 알린다. */
export async function run(ctx) {
  const options = ctx.config.checks.writing
  const { docs, matches, ruleNames } = scanDocs(ctx, options)
  if (docs.length === 0) return { status: 'skip', summary: ctx.t('writing.no-docs'), findings: [], metrics: {}, current: null }
  const banned = matches.filter((match) => match.rule !== NOUN_CHAIN)
  const chains = matches.filter((match) => match.rule === NOUN_CHAIN)
  const shown = ctx.mode === 'warn' ? [...banned, ...chains] : banned
  const current = tallyByRuleAndFile(banned, ruleNames)
  const metrics = Object.fromEntries(ruleNames.map((rule) => [rule, banned.filter((match) => match.rule === rule).length]))
  return {
    status: shown.length > 0 ? 'findings' : 'pass',
    summary: ctx.t('writing.summary', { docs: docs.length, count: banned.length, chains: chains.length }),
    findings: shown.map((match) => toFinding(match, ctx.t)),
    metrics: { ...metrics, [NOUN_CHAIN]: chains.length, docs: docs.length },
    current,
  }
}
