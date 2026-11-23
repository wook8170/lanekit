// 지침 예산 검사(guidance) — 지침 파일을 읽어 규칙 네 가지에 넘기고, 실행기의 계약대로 결과를 돌려준다.
// 부르는 곳: gate.mjs(등록표의 guidance). 다른 검사를 쓸 때 이 파일을 견본으로 본다.
// 먼저 읽을 파일: rules.mjs(규칙), ../../lib/runner.mjs(ctx 가 만들어지는 곳).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RULES_KO } from '../writing/rules-ko.mjs'
import { findDuplicateHeadings, findMachineBoundPaths, findOversize, findSelfViolations, RULE_NAMES } from './rules.mjs'

export const meta = {
  id: 'guidance',
  profiles: ['light', 'changed', 'full'],
  defaultMode: 'warn',
  ratchetable: true,
}

function readDocs(root, files) {
  return files
    .filter((file) => existsSync(join(root, file)))
    .map((file) => {
      const content = readFileSync(join(root, file))
      return { file, text: content.toString('utf8'), bytes: content.length }
    })
}

function collectFindings(docs, options) {
  return [
    ...docs.flatMap((doc) => findOversize(doc, options)),
    ...findDuplicateHeadings(docs),
    ...docs.flatMap(findMachineBoundPaths),
    ...docs.flatMap((doc) => findSelfViolations(doc, RULES_KO['forced-translation'])),
  ]
}

/** 기준선과 견줄 값 { 규칙: { 파일: 양 } }. 찾은 것이 없는 규칙도 빈 칸으로 넣어, 기준선에 규칙 이름이 남게 한다. */
function tallyByRuleAndFile(rawFindings) {
  const current = Object.fromEntries(RULE_NAMES.map((rule) => [rule, {}]))
  for (const found of rawFindings) {
    current[found.rule][found.file] = (current[found.rule][found.file] ?? 0) + found.amount
  }
  return current
}

const countByRule = (rawFindings) =>
  Object.fromEntries(RULE_NAMES.map((rule) => [rule, rawFindings.filter((found) => found.rule === rule).length]))

/** 검사 계약의 run. ctx 는 { root, config, mode, profile, changedFiles, baseline, git, t } 다. */
export async function run(ctx) {
  const options = ctx.config.checks.guidance
  const docs = readDocs(ctx.root, options.files)
  if (docs.length === 0) {
    return { status: 'skip', summary: ctx.t('guidance.no-files'), findings: [], metrics: {}, current: null }
  }
  const rawFindings = collectFindings(docs, options)
  const findings = rawFindings.map((found) => ({
    file: found.file,
    line: found.line,
    rule: found.rule,
    message: ctx.t(found.messageKey, { ...found.vars, value: found.value, limit: found.limit }),
    value: found.value,
    limit: found.limit,
  }))
  return {
    status: findings.length > 0 ? 'findings' : 'pass',
    summary: ctx.t('guidance.summary', { files: docs.length, count: findings.length }),
    findings,
    metrics: countByRule(rawFindings),
    current: tallyByRuleAndFile(rawFindings),
  }
}
