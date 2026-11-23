// 상한 판정 — 측정 결과를 상한과 견주어, 넘은 것만 규칙별 값 { 규칙: { 키: 수 } } 과 찾은 것의 목록으로 바꾼다. 순수 함수다.
// 부르는 곳: run.mjs(측정 뒤). 기준선과 견주어 통과 · 실패를 정하는 일은 실행기(lib/verdict.mjs)가 한다.
// 먼저 읽을 파일: measure.mjs(측정 결과의 모양), relock.mjs(이 값을 기준선에 맞춰 다듬는 곳).
//
// 키는 파일 단위 규칙이면 파일 경로, 함수 단위 규칙이면 「파일#함수 키」다. 상한 아래인 값은 싣지 않는다.
import { buildImportGraph, cycleSizes, findCycles } from './cycles.mjs'

/** 함수 단위 규칙. relock.mjs 가 이름이 바뀐 함수를 맞출 때 이 목록을 쓴다. */
export const FN_RULES = ['fnLines', 'complexity', 'depth', 'componentHooks']

// 파일 단위 규칙. read 는 그 파일의 값을, limit 은 상한을 돌려준다(limit 이 없으면 0 이다).
// isCount 는 값이 「몇 곳」인 규칙이다. 지표에는 파일 수가 아니라 곳의 합을 싣는다.
const CORE_FILE_RULES = [
  { rule: 'fileLines', read: ({ measurement }) => measurement.lines, limit: (limits) => limits.fileLines },
  { rule: 'emptyCatch', isCount: true, read: ({ measurement }) => measurement.emptyCatch },
  { rule: 'console', isCount: true, read: ({ file, measurement, settings }) => (settings.isConsoleExempt(file) ? 0 : measurement.console) },
]
const READABLE_FILE_RULES = [
  { rule: 'paramsOverLimit', isCount: true, read: ({ measurement }) => measurement.params },
  { rule: 'shortIdentifiers', isCount: true, read: ({ measurement }) => measurement.shortIds },
  { rule: 'historyComments', isCount: true, read: ({ measurement }) => measurement.history },
  { rule: 'missingFileHeader', read: ({ measurement }) => (measurement.hasHeader ? 0 : 1) },
]
const ROUTE_FILE_RULES = [
  { rule: 'routesPerFile', read: ({ measurement }) => measurement.routes, limit: (limits) => limits.routesPerFile },
  { rule: 'routeDb', isCount: true, read: ({ measurement }) => measurement.db },
  { rule: 'routeDbIndirect', isCount: true, read: ({ measurement }) => measurement.dbIndirect },
  { rule: 'serverTop', read: ({ file, settings }) => (settings.isServerTop(file) ? 1 : 0) },
]

// 함수 단위 규칙. 줄 수 상한은 함수 종류(fn · component · route)마다 다르다.
const FUNCTION_RULES = [
  { rule: 'fnLines', read: (fn) => fn.lines, limit: (fn, limits) => limits[fn.kind].fail },
  { rule: 'complexity', read: (fn) => fn.complexity, limit: (fn, limits) => limits.complexity },
  { rule: 'depth', read: (fn) => fn.depth, limit: (fn, limits) => limits.depth },
  { rule: 'componentHooks', read: (fn) => (fn.kind === 'component' ? fn.hooks : 0), limit: (fn, limits) => limits.componentHooks },
]

/** 설정에서 켠 묶음의 파일 단위 규칙. */
function activeFileRules(settings) {
  return [
    ...CORE_FILE_RULES,
    ...(settings.isReadableOn ? READABLE_FILE_RULES : []),
    ...(settings.isRoutesOn ? ROUTE_FILE_RULES : []),
  ]
}

function collectFileFindings(measured, settings) {
  const found = []
  for (const [file, measurement] of Object.entries(measured)) {
    for (const { rule, read, limit } of activeFileRules(settings)) {
      const value = read({ file, measurement, settings })
      const cap = limit ? limit(settings.limits) : 0
      if (value > cap) found.push({ rule, key: file, file, line: null, value, limit: cap })
    }
  }
  return found
}

function collectFunctionFindings(measured, limits) {
  const found = []
  for (const [file, measurement] of Object.entries(measured)) {
    for (const fn of measurement.functions) {
      for (const { rule, read, limit } of FUNCTION_RULES) {
        const value = read(fn)
        const cap = limit(fn, limits)
        if (value > cap) found.push({ rule, key: `${file}#${fn.key}`, file, line: fn.line, value, limit: cap, name: fn.key })
      }
    }
  }
  return found
}

function collectCycleFindings(groups) {
  const sizes = cycleSizes(groups)
  return groups.flatMap((group) =>
    group.map((file) => ({ rule: 'cycles', key: file, file, line: null, value: sizes[file], limit: 0, name: group.filter((member) => member !== file).join(', ') })),
  )
}

/** 찾은 것의 목록 → { 규칙: { 키: 수 } }. 찾은 것이 없는 규칙도 빈 칸으로 넣어, 기준선에 규칙 이름이 남게 한다. */
function tallyValues(found, rules) {
  const values = Object.fromEntries(rules.map((rule) => [rule, {}]))
  for (const { rule, key, value } of found) values[rule][key] = value
  return values
}

function countWarnLevel(measured, limits) {
  const isOverWarn = (fn) => fn.lines > limits[fn.kind].warn && fn.lines <= limits[fn.kind].fail
  return Object.values(measured).reduce((total, measurement) => total + measurement.functions.filter(isOverWarn).length, 0)
}

const COUNT_RULES = new Set([...CORE_FILE_RULES, ...READABLE_FILE_RULES, ...ROUTE_FILE_RULES].filter((entry) => entry.isCount).map((entry) => entry.rule))

/** 규칙 하나의 지표: 「몇 곳」을 세는 규칙은 값의 합, 나머지는 상한을 넘은 파일 · 함수의 수다. */
function totalOf(rule, found) {
  const matched = found.filter((entry) => entry.rule === rule)
  return COUNT_RULES.has(rule) ? matched.reduce((total, entry) => total + entry.value, 0) : matched.length
}

/**
 * 측정 결과를 상한과 견준다.
 * settings 는 { limits, isReadableOn, isRoutesOn, isConsoleExempt, isServerTop } 다. limits 에는 fn · component · route 의 { warn, fail } 이 있다.
 * 돌려주는 것: values(기준선과 견줄 값) · found(찾은 것) · metrics(증거 파일에 남길 수).
 */
export function judgeStructure(measured, settings) {
  const groups = findCycles(buildImportGraph(measured))
  const found = [...collectFileFindings(measured, settings), ...collectFunctionFindings(measured, settings.limits), ...collectCycleFindings(groups)]
  const rules = [...activeFileRules(settings).map((entry) => entry.rule), ...FN_RULES, 'cycles']
  const metrics = {
    files: Object.keys(measured).length,
    functions: Object.values(measured).reduce((total, measurement) => total + measurement.functions.length, 0),
    fnOverWarn: countWarnLevel(measured, settings.limits),
    cycleGroups: groups.length,
    ...Object.fromEntries(rules.map((rule) => [rule, totalOf(rule, found)])),
  }
  return { values: tallyValues(found, rules), found, metrics }
}
