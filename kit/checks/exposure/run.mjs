// 공개 노출 검사(exposure) — 추적 중인 파일과 이력에 금지어가 있는지 본다. 맞은 낱말은 어디에도 출력하지 않는다.
// 부르는 곳: gate.mjs(등록표의 exposure. 공개 저장소에서 기본으로 켜진다).
// 먼저 읽을 파일: denylist.mjs(목록 읽기와 맞추기).
import { ConfigError } from '../../lib/config.mjs'
import { listTrackedFiles, readTextFile } from '../../lib/files.mjs'
import { matchesAny } from '../../lib/glob.mjs'
import { readAddedLines, readCommitMessages, readRefTexts } from '../../lib/history.mjs'
import { findDenylistFile, matchRuleNumbers, readDenylist } from './denylist.mjs'
import { splitLines } from '../../lib/platform.mjs'

export const meta = {
  id: 'exposure',
  profiles: ['light', 'changed', 'full'],
  defaultMode: 'auto',
  ratchetable: false,
}

const SHORT_COMMIT = 8
const COMMIT_MESSAGE = '(commit message)'
const REF_LABEL = '(ref)'

/** 순수 판정. 허용 항목의 rule 이 0 이면 그 파일의 모든 규칙을 허용한다. */
export function dropAllowed(found, allow) {
  const isAllowed = (entry) => allow.some((allowed) => matchesAny(entry.file, [allowed.file]) && (allowed.rule === 0 || allowed.rule === entry.number))
  return found.filter((entry) => !isAllowed(entry))
}

const matchesOf = (text, rules, place) => matchRuleNumbers(text, rules).map((number) => ({ ...place, number }))

// 파일 이름도 본다. 금지어가 든 이름은 내용과 상관없이 드러난다.
function scanWorkTree(ctx, rules) {
  return listTrackedFiles(ctx.root, ctx.git).flatMap((file) => {
    const inName = matchesOf(file, rules, { file, line: null, commit: null })
    const lines = splitLines(readTextFile(ctx.root, file) ?? '')
    return [...inName, ...lines.flatMap((text, index) => matchesOf(text, rules, { file, line: index + 1, commit: null }))]
  })
}

function scanHistory(ctx, rules) {
  const inDiffs = readAddedLines(ctx.git).flatMap((added) => matchesOf(added.text, rules, { file: added.file, line: null, commit: added.commit }))
  const inMessages = readCommitMessages(ctx.git).flatMap((message) =>
    splitLines(message.text).flatMap((text) => matchesOf(text, rules, { file: COMMIT_MESSAGE, line: null, commit: message.commit })),
  )
  return [...inDiffs, ...inMessages, ...scanRefs(ctx, rules)]
}

// 태그와 브랜치는 커밋 밖에 있지만 푸시하면 공개된다. 이름, 태그를 단 사람, 태그 메시지를 본다. 한 ref 에서 같은 규칙은 한 번만 알린다.
function scanRefs(ctx, rules) {
  return readRefTexts(ctx.git).flatMap((entry) => {
    const numbers = new Set(splitLines(entry.text).flatMap((text) => matchRuleNumbers(text, rules)))
    return [...numbers].map((number) => ({ file: `${REF_LABEL} ${entry.ref}`, line: null, commit: null, number }))
  })
}

/** 목록을 읽는다. 공개 저장소인데 목록이 없거나 목록의 줄이 틀렸으면 설정 오류다(게이트의 종료 코드 2). */
function loadRules(ctx) {
  const file = findDenylistFile()
  if (!file) {
    if (ctx.config.repo.visibility !== 'public') return null
    throw new ConfigError([{ path: 'checks.exposure', code: 'denylist-missing' }], ctx.config.lang)
  }
  const { rules, invalidLines } = readDenylist(file)
  if (invalidLines.length > 0) {
    throw new ConfigError([{ path: 'checks.exposure', code: 'denylist-invalid', got: invalidLines.join(', ') }], ctx.config.lang)
  }
  // 규칙이 하나도 없는 목록은 아무것도 막지 못한다. 목록이 없는 것과 같게 다룬다.
  if (rules.length === 0 && ctx.config.repo.visibility === 'public') {
    throw new ConfigError([{ path: 'checks.exposure', code: 'denylist-empty' }], ctx.config.lang)
  }
  return rules
}

const toFinding = (found, translate) => ({
  file: found.commit ? `${found.file}@${found.commit.slice(0, SHORT_COMMIT)}` : found.file,
  line: found.line,
  rule: `deny-${found.number}`,
  message: translate(found.commit ? 'exposure.found-in-history' : 'exposure.found', { number: found.number }),
  value: 1,
  limit: 0,
})

/** 검사 계약의 run. full 프로필에서는 이력의 더해진 줄, 커밋 메시지, 태그와 브랜치도 본다. */
export async function run(ctx) {
  const rules = loadRules(ctx)
  if (rules === null) return { status: 'skip', summary: ctx.t('exposure.no-denylist'), findings: [], metrics: {}, current: null }
  const scanned = ctx.profile === 'full' ? [...scanWorkTree(ctx, rules), ...scanHistory(ctx, rules)] : scanWorkTree(ctx, rules)
  const kept = dropAllowed(scanned, ctx.config.checks.exposure.allow)
  return {
    status: kept.length > 0 ? 'findings' : 'pass',
    summary: ctx.t('exposure.summary', { rules: rules.length, count: kept.length, allowed: scanned.length - kept.length }),
    findings: kept.map((found) => toFinding(found, ctx.t)),
    metrics: { rules: rules.length, findings: kept.length, allowed: scanned.length - kept.length },
    current: null,
  }
}
