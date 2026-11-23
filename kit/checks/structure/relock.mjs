// 기준선에 맞춰 다듬기 — 상한을 넘은 값을 기준선과 견주기 전에, 허용 폭 안의 증가와 이름만 바뀐 함수를 기준선의 칸에 맞춘다. 순수 함수다.
// 부르는 곳: run.mjs. 실행기의 래칫 판정과 재잠금(--relock)이 모두 이 결과(current)를 기준선과 견준다.
// 먼저 읽을 파일: ../../lib/baseline.mjs 의 compareValues(칸마다 그대로 견주는 쪽), ratchet.mjs(다듬기 전 값).
//
// 실행기는 칸마다 「지금 값 > 기준선 값」이면 늘었다고 본다. 그래서 봐줄 증가는 여기서 기준선 값으로 바꿔 둔다.
//   허용 폭 — 이미 상한을 넘은 파일 · 함수의 줄 수는 기준선 값 + 허용 폭까지 기준선 값으로 적는다. 다른 수치에는 허용 폭이 없다.
//   이름 바꿈 — 기준선에 없는 함수 키가, 같은 파일의 짝 없는 기준선 함수보다 크지 않으면 그 함수의 키로 적는다.
//   재잠금 — 판정은 위의 값으로 하고, 기준선에는 함수의 지금 이름으로 적는다(relockValues).
// 새 파일 · 새 함수는 기준선에 칸이 없어서 그대로 남고, 실행기가 상한 0 으로 본다.
import { FN_RULES } from './ratchet.mjs'

// 허용 폭이 있는 규칙과 설정 slack 의 칸 이름
const SLACK_KEYS = { fileLines: 'fileLines', fnLines: 'fnLines' }

const allowedUpTo = (rule, baseValue, slack) => baseValue + (slack[SLACK_KEYS[rule]] ?? 0)

/** 「파일#함수 키」를 파일과 함수 키로 나눈다. 함수 키에도 `#` 가 있을 수 있어 첫 `#` 에서만 나눈다. */
function splitFunctionKey(key) {
  const at = key.indexOf('#')
  return { file: key.slice(0, at), fnKey: key.slice(at + 1) }
}

/** 함수 단위 규칙의 칸을 { 파일: { 함수 키: { 규칙: 수 } } } 로 모은다. */
function groupFunctionCells(values) {
  const byFile = {}
  for (const rule of FN_RULES) {
    for (const [key, value] of Object.entries(values[rule] ?? {})) {
      const { file, fnKey } = splitFunctionKey(key)
      byFile[file] ??= {}
      byFile[file][fnKey] ??= {}
      byFile[file][fnKey][rule] = value
    }
  }
  return byFile
}

/** 지금 함수의 수치가 기준선 함수의 칸 안에 드는가. 기준선 함수에 없는 규칙을 넘었으면 들지 않는다. */
function fitsWithin(currentCells, baseCells, slack) {
  return Object.entries(currentCells).every(([rule, value]) => baseCells[rule] !== undefined && value <= allowedUpTo(rule, baseCells[rule], slack))
}

function matchRenamesInFile(currentFns, baseFns, slack) {
  const unmatched = Object.keys(baseFns).filter((fnKey) => !(fnKey in currentFns))
  const renames = []
  for (const fnKey of Object.keys(currentFns).filter((candidate) => !(candidate in baseFns))) {
    const match = unmatched.find((baseKey) => fitsWithin(currentFns[fnKey], baseFns[baseKey], slack))
    if (!match) continue
    unmatched.splice(unmatched.indexOf(match), 1)
    renames.push({ from: match, to: fnKey })
  }
  return renames
}

/** 이름만 바뀐 것으로 볼 함수의 목록 [{ file, from, to }]. */
export function findRenamedFunctions(values, baseline, slack) {
  const current = groupFunctionCells(values)
  const base = groupFunctionCells(baseline)
  return Object.keys(current).flatMap((file) =>
    matchRenamesInFile(current[file], base[file] ?? {}, slack).map((rename) => ({ file, ...rename })),
  )
}

/** 함수 단위 규칙의 키를 바꾼다. keyPairs 는 [[지금 키, 바꿀 키]] 다. */
function rekeyFunctions(values, keyPairs) {
  const nextKeyOf = new Map(keyPairs)
  const rekeyed = { ...values }
  for (const rule of FN_RULES) {
    if (!values[rule]) continue
    rekeyed[rule] = Object.fromEntries(Object.entries(values[rule]).map(([key, value]) => [nextKeyOf.get(key) ?? key, value]))
  }
  return rekeyed
}

const newKeyOf = (rename) => `${rename.file}#${rename.to}`
const oldKeyOf = (rename) => `${rename.file}#${rename.from}`

function applySlack(values, baseline, slack) {
  const eased = { ...values }
  for (const rule of Object.keys(SLACK_KEYS)) {
    const baseCells = baseline[rule]
    if (!values[rule] || !baseCells) continue
    const ease = (key, value) => (baseCells[key] !== undefined && value > baseCells[key] && value <= allowedUpTo(rule, baseCells[key], slack) ? baseCells[key] : value)
    eased[rule] = Object.fromEntries(Object.entries(values[rule]).map(([key, value]) => [key, ease(key, value)]))
  }
  return eased
}

/** 기준선보다 줄었거나 사라진 칸의 수. 0 보다 크면 재잠금해서 새 값을 기준으로 삼을 수 있다. */
function countShrunkCells(current, baseline) {
  let shrunk = 0
  for (const [rule, cells] of Object.entries(current)) {
    for (const [key, baseValue] of Object.entries(baseline[rule] ?? {})) if ((cells[key] ?? 0) < baseValue) shrunk++
  }
  return shrunk
}

/**
 * 상한을 넘은 값(values)을 기준선(baseline, 없으면 null)에 맞춰 다듬는다. slack 은 설정의 { fileLines, fnLines } 다.
 * 돌려주는 것: current(실행기가 기준선과 견줄 값) · renames(이름이 바뀐 것으로 본 함수) · shrunkCells
 * · relockValues(재잠금 때 기준선에 쓸 값). relockValues 는 current 와 수가 같고, 이름이 바뀐 함수의 키만 지금 이름이다.
 * 판정은 옛 키로 해야 「이름만 바뀐 함수」가 새 함수로 보이지 않고, 기준선에는 지금 이름을 적어야 다음 판정이 맞는다.
 */
export function fitToBaseline(values, baseline, slack) {
  if (!baseline) return { current: values, renames: [], shrunkCells: 0, relockValues: values }
  const renames = findRenamedFunctions(values, baseline, slack)
  const renamedToOld = rekeyFunctions(values, renames.map((rename) => [newKeyOf(rename), oldKeyOf(rename)]))
  const current = applySlack(renamedToOld, baseline, slack)
  const relockValues = rekeyFunctions(current, renames.map((rename) => [oldKeyOf(rename), newKeyOf(rename)]))
  return { current, renames, shrunkCells: countShrunkCells(current, baseline), relockValues }
}
