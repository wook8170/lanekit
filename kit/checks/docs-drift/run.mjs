// 문서 드리프트 검사(docs-drift) — 설정의 facts 마다 문서에 적힌 값과 코드에서 센 값을 견준다. 기준선은 쓰지 않는다.
// 부르는 곳: gate.mjs(등록표의 docs-drift).
// 먼저 읽을 파일: claims.mjs(판정) → sources.mjs(코드에서 값을 세는 다섯 가지 방법).
import { readTextFile } from '../../lib/files.mjs'
import { findClaims, judgeFact } from './claims.mjs'
import { measureSource, openProject } from './sources.mjs'

export const meta = {
  id: 'docs-drift',
  profiles: ['light', 'changed', 'full'],
  defaultMode: 'warn',
  ratchetable: false,
}

/** 사실 하나를 보고 찾은 것의 목록을 돌려준다. 명령 원천을 미뤘으면 null 이다. */
function checkFact(fact, project) {
  const problemAt = (rule, detail) => [{ fact: fact.id, file: fact.doc, line: null, rule, vars: { detail } }]
  const docText = readTextFile(project.root, fact.doc)
  if (docText === null) return problemAt('doc-missing', fact.doc)
  const measured = measureSource(fact.source, project)
  if (measured.deferred) return null
  if (measured.problem) return problemAt(measured.problem, measured.detail)
  let claims
  try {
    claims = findClaims(docText, fact.pattern)
  } catch (error) {
    return problemAt('pattern-invalid', error.message)
  }
  return judgeFact(claims, measured.value).map((found) => ({
    fact: fact.id,
    file: fact.doc,
    line: found.line,
    rule: found.rule,
    vars: { stated: found.stated, actual: found.actual, pattern: fact.pattern },
  }))
}

const toFinding = (found, translate) => ({
  file: found.file,
  line: found.line,
  rule: found.rule,
  message: translate(`docs-drift.${found.rule}`, { ...found.vars, fact: found.fact }),
  value: found.vars.stated ?? null,
  limit: found.vars.actual ?? null,
})

/** 검사 계약의 run. facts 가 비어 있으면 건너뛴다. */
export async function run(ctx) {
  const { facts } = ctx.config.checks['docs-drift']
  if (facts.length === 0) return { status: 'skip', summary: ctx.t('docs-drift.no-facts'), findings: [], metrics: {}, current: null }
  const project = openProject({ root: ctx.root, git: ctx.git, profile: ctx.profile })
  const checked = facts.map((fact) => checkFact(fact, project))
  const deferred = checked.filter((found) => found === null).length
  const findings = checked.flatMap((found) => found ?? []).map((found) => toFinding(found, ctx.t))
  return {
    status: findings.length > 0 ? 'findings' : 'pass',
    summary: ctx.t('docs-drift.summary', { facts: facts.length, count: findings.length, deferred }),
    findings,
    metrics: { facts: facts.length, findings: findings.length, deferredCommands: deferred },
    current: null,
  }
}
