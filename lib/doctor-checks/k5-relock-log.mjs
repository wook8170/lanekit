// K5 — 재잠금 이력에 사유가 없는 항목이나 결정 ID 가 없는 증가가 있는지, 기준선 파일의 파일별 값이 이력의 마지막 잠금과 같은지 본다.
// 이력이나 기준선을 손으로 고친 경우를 알리기 위해서다.
// 부르는 곳: index.mjs.
// 먼저 읽을 파일: ../../kit/lib/baseline.mjs 의 applyRelock(이력 한 줄의 모양).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RELOCK_LOG, baselineDir } from '../../kit/lib/baseline.mjs'
import { isPlainObject, readJsonOr } from '../json-file.mjs'
import { ok, warn } from './result.mjs'

export const meta = { id: 'K5', title: 'doctor.K5.title' }

function parseLine(line) {
  try {
    return JSON.parse(line)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return null
  }
}

/** 순수 판정. 이력 한 줄이 통제를 벗어났는가: 읽을 수 없거나, 사유가 없거나, 늘었는데 결정 ID 가 없다. */
export function isUncontrolled(entry) {
  if (!entry || typeof entry.reason !== 'string' || entry.reason.trim() === '') return true
  return Boolean(entry.increased) && !entry.decision
}

// 키의 순서와 상관없이 같은 값인지 보려고, 키를 이름순으로 늘어놓은 글로 바꿔 견준다.
const toSortedJson = (value) =>
  JSON.stringify(value, (key, nested) => (isPlainObject(nested) ? Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left.localeCompare(right))) : nested))
const isSame = (left, right) => toSortedJson(left) === toSortedJson(right)

/** 순수 판정. 기준선의 값이 이력 한 줄의 파일별 값(values)과 같은가. 값이 없는 줄은 견줄 수 없으므로 다른 것으로 본다. */
function matchesEntry(values, entry) {
  return isPlainObject(entry.values) && isSame(values, entry.values)
}

/**
 * 순수 판정. 기준선 파일의 값이 이력에 남은 그 검사의 마지막 잠금과 다른 검사를 찾는다.
 * baselines 는 { 검사: 기준선 파일의 values }, entries 는 이력의 줄들이다. 이력에 없는 기준선도 손으로 만든 것으로 본다.
 * 파일별 값으로 견주므로, 한 파일을 줄이고 다른 파일을 늘려 합계를 맞춘 것도 찾는다.
 */
export function findEditedBaselines(baselines, entries) {
  const lastEntry = Object.fromEntries(entries.filter((entry) => entry?.check).map((entry) => [entry.check, entry]))
  return Object.keys(baselines).filter((id) => !lastEntry[id] || !matchesEntry(baselines[id], lastEntry[id]))
}

function readBaselineValues(dir) {
  if (!existsSync(dir)) return {}
  const files = readdirSync(dir).filter((name) => name.endsWith('.json'))
  const stored = files.map((name) => [name.slice(0, -'.json'.length), readJsonOr(join(dir, name), null)?.values])
  return Object.fromEntries(stored.filter(([, values]) => isPlainObject(values)))
}

export function check(ctx) {
  const dir = baselineDir(ctx.root)
  const file = join(dir, RELOCK_LOG)
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '') : []
  const entries = lines.map(parseLine)
  const edited = findEditedBaselines(readBaselineValues(dir), entries)
  if (edited.length > 0) return warn(ctx.t('doctor.K5.edited', { checks: edited.join(', ') }), ctx.t('doctor.K5.fix-edited'))
  if (lines.length === 0) return ok(ctx.t('doctor.K5.none'))
  const flagged = entries.flatMap((entry, index) => (isUncontrolled(entry) ? [index + 1] : []))
  if (flagged.length === 0) return ok(ctx.t('doctor.K5.ok', { count: lines.length }))
  return warn(ctx.t('doctor.K5.flagged', { lines: flagged.join(', ') }), ctx.t('doctor.K5.fix'))
}
