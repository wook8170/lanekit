// 비밀값 검사(secrets) — gitleaks 가 있으면 그것을, 없으면 내장 규칙 여섯 가지를 쓴다. 찾은 값은 출력하지 않는다.
// 부르는 곳: gate.mjs(등록표의 secrets).
// 먼저 읽을 파일: secret-rules.mjs(내장 규칙) → gitleaks.mjs(gitleaks 를 부르고 결과를 읽는 곳).
import { findExecutable } from '../../lib/exec.mjs'
import { listTrackedFiles, readTextFile } from '../../lib/files.mjs'
import { matchesAny } from '../../lib/glob.mjs'
import { readAddedLines } from '../../lib/history.mjs'
import { runGitleaks } from './gitleaks.mjs'
import { matchSecretRules, scanTextForSecrets } from './secret-rules.mjs'

export const meta = {
  id: 'secrets',
  profiles: ['light', 'changed', 'full'],
  defaultMode: 'fail',
  ratchetable: false,
}

const SHORT_COMMIT = 8

/** 순수 판정. 설정의 tool 과 gitleaks 가 있는지로 쓸 도구를 정한다. */
export function chooseTool(configured, hasGitleaks) {
  if (configured === 'builtin') return { tool: 'builtin' }
  if (hasGitleaks) return { tool: 'gitleaks' }
  return configured === 'gitleaks' ? { tool: null, problem: 'gitleaks-missing' } : { tool: 'builtin' }
}

/** 순수 판정. 허용 목록에 든 것을 뺀다. 허용 항목의 rule 이 비어 있으면 그 파일의 모든 규칙을 허용한다. */
export function dropAllowed(found, allow) {
  const isAllowed = (entry) => allow.some((allowed) => matchesAny(entry.file, [allowed.file]) && (!allowed.rule || allowed.rule === entry.rule))
  return found.filter((entry) => !isAllowed(entry))
}

function scanWorkTree(ctx) {
  return listTrackedFiles(ctx.root, ctx.git).flatMap((file) => {
    const text = readTextFile(ctx.root, file)
    return text === null ? [] : scanTextForSecrets(text).map((found) => ({ ...found, file, commit: null }))
  })
}

function scanHistory(ctx) {
  return readAddedLines(ctx.git).flatMap((added) =>
    matchSecretRules(added.text).map((rule) => ({ file: added.file, line: null, rule, commit: added.commit })),
  )
}

function scanBuiltin(ctx) {
  return ctx.profile === 'full' ? [...scanWorkTree(ctx), ...scanHistory(ctx)] : scanWorkTree(ctx)
}

const toFinding = (found, translate) => ({
  file: found.commit ? `${found.file}@${found.commit.slice(0, SHORT_COMMIT)}` : found.file,
  line: found.line,
  rule: found.rule,
  message: translate(found.commit ? 'secrets.found-in-history' : 'secrets.found'),
  value: 1,
  limit: 0,
})

/** 검사 계약의 run. full 프로필에서는 이력도 본다. */
export async function run(ctx) {
  const options = ctx.config.checks.secrets
  const gitleaksFile = findExecutable('gitleaks')
  const choice = chooseTool(options.tool, gitleaksFile !== null)
  if (choice.problem) return { status: 'error', summary: ctx.t(`secrets.${choice.problem}`), findings: [], metrics: {}, current: null }
  const scanned = choice.tool === 'gitleaks' ? runGitleaks(gitleaksFile, ctx) : { found: scanBuiltin(ctx) }
  if (scanned.problem) {
    return { status: 'error', summary: ctx.t('secrets.gitleaks-failed', { detail: scanned.problem }), findings: [], metrics: {}, current: null }
  }
  const kept = dropAllowed(scanned.found, options.allow)
  return {
    status: kept.length > 0 ? 'findings' : 'pass',
    summary: ctx.t('secrets.summary', { tool: choice.tool, count: kept.length, allowed: scanned.found.length - kept.length }),
    findings: kept.map((found) => toFinding(found, ctx.t)),
    metrics: { findings: kept.length, allowed: scanned.found.length - kept.length, usedGitleaks: choice.tool === 'gitleaks' ? 1 : 0 },
    current: null,
  }
}
