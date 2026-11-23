// 구조 검사(structure) — 소스 파일을 재고, 상한을 넘은 것을 실행기의 계약대로 돌려준다. 통과 · 실패는 실행기가 정한다.
// 부르는 곳: gate.mjs(등록표의 structure). 재잠금(--relock structure) 때도 같은 run 이 불린다.
// 먼저 읽을 파일: measure.mjs(재기) → ratchet.mjs(상한과 견주기) → relock.mjs(기준선에 맞춰 다듬기).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createMatcher } from '../../lib/glob.mjs'
import { measureSource } from './measure.mjs'
import { judgeStructure } from './ratchet.mjs'
import { compileReadableRules } from './readable.mjs'
import { fitToBaseline } from './relock.mjs'
import { listProjectFiles, selectSources } from './source.mjs'
import { bindTypescript, hasCompilerApi, locateTypescript, ts } from './typescript.mjs'

export const meta = {
  id: 'structure',
  profiles: ['light', 'changed', 'full'],
  defaultMode: 'warn',
  ratchetable: true,
}

const CORE_MODULE = 'ts'
const ROUTES_MODULE = 'ts-fastify'

const emptyResult = (status, summary) => ({ status, summary, findings: [], metrics: {}, current: null })

/**
 * 컴파일러를 찾아 묶는다. 잴 수 있으면 null 을 돌려주고, 잴 수 없으면 건너뛰는 결과를 돌려준다.
 * 모듈을 켜지 않았으면 잴 것이 없는 것이다. 모듈을 켰는데 컴파일러가 없으면 확인하지 못한 것(unverified)이다.
 */
function prepareCompiler(ctx, options) {
  if (!ctx.config.modules.includes(CORE_MODULE)) return emptyResult('skip', ctx.t('structure.skip.no-module'))
  const compiler = locateTypescript(ctx.root, options.typescriptFrom)
  if (!compiler) return { ...emptyResult('skip', ctx.t('structure.skip.no-typescript', { from: options.typescriptFrom || '.' })), unverified: true }
  if (!hasCompilerApi(compiler)) return { ...emptyResult('skip', ctx.t('structure.skip.no-compiler-api', { version: compiler.version ?? '?' })), unverified: true }
  bindTypescript(compiler)
  return null
}

/** 켠 ts-fastify 모듈에서 라우트 규칙을 읽는다. 모듈을 켜지 않았으면 null 이다. */
async function loadRouteRules(ctx, routes) {
  if (!ctx.config.modules.includes(ROUTES_MODULE)) return null
  const rulesFile = join(ctx.modules[ROUTES_MODULE], 'route-rules.mjs')
  const { createRouteRules } = await import(pathToFileURL(rulesFile).href)
  try {
    return { rules: createRouteRules(ts, routes), broken: [] }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return { rules: null, broken: [`${routes.appDbPattern} (${error.message})`] }
  }
}

/** 설정을 측정과 판정에 쓰는 값으로 바꾼다. broken 은 문법이 틀린 정규식의 목록이다. */
async function planMeasurement(ctx, options) {
  const readable = options.readable.enabled ? compileReadableRules(options.readable) : null
  const routes = await loadRouteRules(ctx, options.routes)
  const settings = {
    limits: { ...options.limits, route: routes ? options.routes.route : options.limits.fn, routesPerFile: options.routes.routesPerFile },
    isReadableOn: readable !== null,
    isRoutesOn: routes !== null,
    isConsoleExempt: createMatcher(options.console.exempt),
    isServerTop: createMatcher([options.routes.serverTop]),
  }
  return {
    readable,
    routeRules: routes?.rules ?? null,
    isRouteFile: routes ? createMatcher(options.routes.files) : () => false,
    settings,
    broken: [...(readable?.broken ?? []), ...(routes?.broken ?? [])],
  }
}

function measureFiles(root, files, plan) {
  const measured = {}
  for (const file of files) {
    // git 이 아는 파일이라도 작업 트리에서 지웠으면 없다.
    if (!existsSync(join(root, file))) continue
    const routeRules = plan.isRouteFile(file) ? plan.routeRules : null
    measured[file] = measureSource(file, readFileSync(join(root, file), 'utf8'), { readable: plan.readable, routeRules })
  }
  return measured
}

function summarize(ctx, metrics, fitted) {
  const notes = [ctx.t('structure.summary', { files: metrics.files, functions: metrics.functions, count: metrics.findings })]
  if (fitted.renames.length > 0) notes.push(ctx.t('structure.note.renamed', { count: fitted.renames.length }))
  if (fitted.shrunkCells > 0) notes.push(ctx.t('structure.note.shrunk', { count: fitted.shrunkCells }))
  return notes.join(' · ')
}

/** 검사 계약의 run. ctx 의 칸은 ../../README.md 「검사의 계약」에 있다. */
export async function run(ctx) {
  const options = ctx.config.checks.structure
  const skipped = prepareCompiler(ctx, options)
  if (skipped) return skipped
  const plan = await planMeasurement(ctx, options)
  if (plan.broken.length > 0) return emptyResult('error', ctx.t('structure.bad-pattern', { patterns: plan.broken.join(' · ') }))

  const files = selectSources(listProjectFiles(ctx.root, ctx.git), options.source)
  const judged = judgeStructure(measureFiles(ctx.root, files, plan), plan.settings)
  const fitted = fitToBaseline(judged.values, ctx.baseline, options.slack)
  const metrics = { ...judged.metrics, findings: judged.found.length, renamedFunctions: fitted.renames.length, shrunkCells: fitted.shrunkCells }
  const findings = judged.found.map(({ file, line, rule, value, limit, name }) => ({
    file,
    line,
    rule,
    message: ctx.t(`structure.finding.${rule}`, { value, limit, name }),
    value,
    limit,
  }))
  return {
    status: findings.length > 0 ? 'findings' : 'pass',
    summary: summarize(ctx, metrics, fitted),
    findings,
    metrics,
    current: fitted.current,
    relockValues: ctx.relock ? fitted.relockValues : null,
  }
}
