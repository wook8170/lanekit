// 기준선 — 검사별 기준선을 읽고, 지금 값과 견주고, 사유를 확인한 뒤 다시 잠그고, 그 이력을 남긴다.
// 부르는 곳: verdict.mjs(ratchet 판정), gate.mjs(--relock).
// 먼저 읽을 파일: verdict.mjs(비교 결과를 어떻게 쓰는가).
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { ConfigError } from './config.mjs'
import { appendInside, isBlockedPath, writeInside } from './safe-write.mjs'

const BASELINE_SCHEMA = 'lanekit-baseline/1'
export const RELOCK_LOG = 'relock-log.jsonl'

// 기준선은 실행기가 어디에 있든 프로젝트의 이 폴더에 둔다. 경로는 루트 기준이다.
const BASELINE_DIR = 'scripts/lanekit/baselines'
const RELOCK_LOG_PATH = `${BASELINE_DIR}/${RELOCK_LOG}`
const baselinePath = (id) => `${BASELINE_DIR}/${id}.json`
export const baselineDir = (root) => join(root, BASELINE_DIR)
const baselineFile = (root, id) => join(root, baselinePath(id))

/** 검사의 기준선 { values, lockedAt, commit } 을 읽는다. 아직 잠그지 않았으면 null 이다. */
export function readBaseline(root, id) {
  const file = baselineFile(root, id)
  if (!existsSync(file)) return null
  const stored = JSON.parse(readFileSync(file, 'utf8'))
  if (stored.schema !== BASELINE_SCHEMA || typeof stored.values !== 'object') {
    throw new ConfigError([{ path: file, code: 'baseline-broken' }])
  }
  return stored
}

// 함수 단위 지표의 키는 「파일#함수이름」이다. 옮긴 파일을 맞출 때는 파일 부분만 본다.
const fileOf = (key) => key.split('#')[0]

const sumWhere = (cells, matches) =>
  Object.entries(cells).reduce((total, [key, amount]) => (matches(key) ? total + amount : total), 0)

/** 규칙별 합계 { 규칙: 수 }. 재잠금 이력에 전후 값으로 남긴다. */
export function sumByRule(values) {
  return Object.fromEntries(Object.entries(values).map(([rule, cells]) => [rule, sumWhere(cells, () => true)]))
}

function movedIncreases(rule, cells, baseCells, moves) {
  return moves.flatMap((move) => {
    const before = sumWhere(baseCells, (key) => fileOf(key) === move.from)
    // 옮기기 전 파일이 아직 남아 있으면 그 값도 묶음에 넣는다. 넣지 않으면 남은 파일에 새 파일을 더한 증가가 숨는다.
    const group = [move.from, ...move.to]
    const after = sumWhere(cells, (key) => group.includes(fileOf(key)))
    return after > before ? [{ rule, key: [move.from, ...move.to].join(' -> '), from: before, to: after }] : []
  })
}

function cellIncreases(rule, cells, baseCells, moves) {
  const movedTargets = new Set(moves.flatMap((move) => move.to))
  return Object.entries(cells)
    .filter(([key]) => !movedTargets.has(fileOf(key)))
    .filter(([key, amount]) => amount > (baseCells[key] ?? 0))
    .map(([key, amount]) => ({ rule, key, from: baseCells[key] ?? 0, to: amount }))
}

/**
 * 순수 판정. 지금 값(current)에서 기준선(base)보다 늘어난 「규칙 × 파일」 칸을 찾는다.
 * 기준선에 없는 파일은 상한 0 으로 본다. 기준선에 없는 규칙은 아직 잠그지 않은 것이라 newRules 로만 알린다.
 * moves 는 [{ from, to: [...] }] 다. 옮긴 묶음은 합계로 견준다.
 */
export function compareValues(current, base, moves = []) {
  const increases = []
  const newRules = []
  for (const [rule, cells] of Object.entries(current)) {
    if (base[rule] === undefined) {
      newRules.push(rule)
      continue
    }
    increases.push(...movedIncreases(rule, cells, base[rule], moves), ...cellIncreases(rule, cells, base[rule], moves))
  }
  return { increases, newRules }
}

// 결정 기록이 아닌 파일: 폴더 안내와 틀.
const NOT_A_DECISION = /^(readme|0000-template)(\.md)?$/i
// 심볼릭 링크는 받지 않는다. 링크는 저장소 밖이나 다른 글을 가리킬 수 있다. 공백만 든 파일도 내용이 없는 것으로 본다.
const isFilledFile = (file) => {
  const stats = lstatSync(file, { throwIfNoEntry: false })
  return Boolean(stats?.isFile()) && readFileSync(file, 'utf8').trim() !== ''
}

/** 결정 ID 는 docs/decisions/ 의 파일 이름이다. 확장자는 적지 않아도 된다. 내용이 있는 파일이어야 하고, 안내 파일 · 틀 · 심볼릭 링크는 받지 않는다. */
export function hasDecisionFile(root, decision) {
  if (!decision || basename(decision) !== decision || decision.startsWith('.') || NOT_A_DECISION.test(decision)) return false
  const dir = join(root, 'docs', 'decisions')
  return isFilledFile(join(dir, decision)) || isFilledFile(join(dir, `${decision}.md`))
}

const isValueTable = (values) => values !== null && typeof values === 'object' && !Array.isArray(values)

/**
 * 재잠금 이력에 남은 그 검사의 마지막 잠금 { values }. values 는 파일별 값 전체다.
 * 이력이 없거나 그 검사의 줄이 없으면 null 이다. 읽을 수 없는 줄은 건너뛴다.
 * 마지막 줄에 파일별 값이 없으면 values 가 null 이다. 그런 줄로는 견줄 수 없어서, 판정하는 쪽이 거절한다(isUnusableLock).
 */
export function readLoggedLock(root, id) {
  const file = join(root, RELOCK_LOG_PATH)
  if (!existsSync(file)) return null
  let logged = null
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    try {
      const entry = JSON.parse(line)
      if (entry?.check === id) logged = { values: isValueTable(entry.values) ? entry.values : null }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }
  return logged
}

/**
 * 순수 판정. 이력의 마지막 줄이 있는데 파일별 값이 없는가. 그런 줄을 받으면 비교가 규칙 합계로 내려가,
 * 한 파일을 줄이고 다른 파일을 늘린 증가가 가려진다. 그래서 받지 않고, 결정 ID 를 적어 다시 잠그게 한다.
 */
export const isUnusableLock = (logged) => Boolean(logged) && !logged.values

// 이력의 칸을 손으로 숫자가 아닌 값으로 바꾸면 견줄 수 없다. 그런 칸과 없는 칸은 잠근 적이 없는 것(0)으로 본다.
const loggedAmount = (cells, key) => (Number.isFinite(cells?.[key]) ? cells[key] : 0)

/**
 * 순수 판정. 기준선 파일의 값 가운데 재잠금 이력의 마지막 잠금(logged)보다 큰 칸을 찾는다. 재잠금을 거치지 않고 올린 값이다.
 * 이력에 그 검사의 줄이 없으면(logged 가 null) 0 보다 큰 칸이 모두 해당한다.
 */
export function unloggedIncreases(baselineValues, logged) {
  return Object.entries(baselineValues).flatMap(([rule, cells]) =>
    Object.entries(cells)
      .filter(([key, amount]) => amount > loggedAmount(logged?.values?.[rule], key))
      .map(([key, amount]) => ({ rule, key, from: loggedAmount(logged?.values?.[rule], key), to: amount })),
  )
}

const smallerCells = (left, right) =>
  Object.fromEntries(Object.keys(left).filter((key) => key in right).map((key) => [key, Math.min(left[key], right[key])]))

/**
 * 순수 함수. 기준선의 값과 이력의 값을 합쳐, 칸마다 더 작은 쪽을 고른 값을 만든다. 한쪽이 없으면 다른 쪽을 그대로 쓴다.
 * 두 쪽 모두에 있는 규칙에서 한쪽에만 있는 칸은 뺀다(없는 칸의 상한은 0 이다).
 * 기준선 파일을 지우거나 손으로 올려도 이력의 값이 남고, 이력보다 낮게 잠긴 기준선도 그대로 지켜진다.
 */
export function strictestValues(baselineValues, loggedValues) {
  if (!baselineValues || !loggedValues) return baselineValues ?? loggedValues ?? null
  const rules = [...new Set([...Object.keys(baselineValues), ...Object.keys(loggedValues)])]
  const pick = (rule) => {
    if (!baselineValues[rule] || !loggedValues[rule]) return baselineValues[rule] ?? loggedValues[rule]
    return smallerCells(baselineValues[rule], loggedValues[rule])
  }
  return Object.fromEntries(rules.map((rule) => [rule, pick(rule)]))
}

/**
 * 순수 판정. 규칙의 합계가 상한(caps)보다 늘어난 것을 찾는다. 칸 비교에서 이미 잡힌 규칙은 뺀다.
 */
function totalIncreases(after, caps, cellIncreases) {
  const flagged = new Set(cellIncreases.map((increase) => increase.rule))
  return Object.entries(after)
    .filter(([rule, total]) => caps[rule] !== undefined && total > caps[rule] && !flagged.has(rule))
    .map(([rule, total]) => ({ rule, key: '(total)', from: caps[rule], to: total }))
}

/**
 * 순수 판정. 같은 파일이 두 옮김에 나오는가(from 끼리 · to 끼리 · 한 옮김의 from 과 다른 옮김의 to).
 * 겹치면 한 파일의 이전 값이 상한으로 두 번 쓰이거나 한 파일의 지금 값이 두 묶음에 들어가, 늘어난 값이 가려진다.
 * 한 옮김 안에서 from 을 to 에 다시 적는 것(파일을 남기고 일부만 떼어 낸 경우)은 겹침이 아니다.
 */
export function hasOverlappingMoves(moves) {
  const files = moves.flatMap((move) => [...new Set([move.from, ...move.to])])
  return new Set(files).size !== files.length
}

const isAllowedIncrease = (request) => Boolean(request.allowIncrease && request.decision)

// 증가가 보이지 않아도 결정 ID 를 요구하는 경우와 그 거절 사유. 견줄 값이 믿을 만하지 않을 때다.
function distrustOf(request, logged) {
  if (isUnusableLock(logged)) return 'log-without-values'
  return hasOverlappingMoves(request.moves) ? 'moves-overlap' : null
}

/**
 * 순수 판정. 재잠금을 받아들일지 정한다. 늘었는지는 파일 단위로 본다. 어느 한 칸이라도 늘었으면 증가다.
 * 견주는 대상은 기준선 파일과 이력의 마지막 잠금(logged) 가운데 칸마다 더 작은 값이다.
 * 옮김이 겹치면 옮김을 쓰지 않고 칸마다 견준다. 옮김이 있으면 규칙 합계가 늘었는지도 본다(옮김은 값을 옮길 뿐 늘리지 못한다).
 * 옮김이 겹치거나 이력의 마지막 줄에 파일별 값이 없으면 증가로 다뤄 결정 ID 를 요구한다.
 * 거절 사유: reason-missing(사유 없음) · log-without-values · moves-overlap · increase-needs-decision(허락 플래그나 결정 ID 가 없음) · decision-not-found.
 */
export function planRelock({ current, baseline, request, decisionExists, logged = null }) {
  const before = baseline ? sumByRule(baseline.values) : {}
  const after = sumByRule(current)
  const reference = strictestValues(baseline?.values ?? null, logged?.values ?? null)
  const distrust = distrustOf(request, logged)
  const moves = distrust === 'moves-overlap' ? [] : request.moves
  const cellIncreases = reference ? compareValues(current, reference, moves).increases : []
  const caps = request.moves.length > 0 && reference ? sumByRule(reference) : {}
  const increases = [...cellIncreases, ...totalIncreases(after, caps, cellIncreases)]
  const plan = { before, after, increases, increased: increases.length > 0 || distrust !== null }
  if (!request.reason?.trim()) return { ...plan, accepted: false, refusal: 'reason-missing' }
  if (!plan.increased) return { ...plan, accepted: true }
  if (!isAllowedIncrease(request)) return { ...plan, accepted: false, refusal: distrust ?? 'increase-needs-decision' }
  if (!decisionExists) return { ...plan, accepted: false, refusal: 'decision-not-found' }
  return { ...plan, accepted: true }
}

/** 재잠금이 쓰는 경로(기준선 파일과 이력) 가운데 쓸 수 없는 것. 쓰기 전에 걸러, 일부만 쓰고 멈추는 일을 막는다. */
export function blockedRelockPaths(root, ids) {
  return [RELOCK_LOG_PATH, ...ids.map(baselinePath)].filter((path) => isBlockedPath(root, path))
}

/** 받아들인 재잠금을 쓴다(저장소 안에만 쓴다): 기준선 파일을 바꾸고 이력 한 줄을 더한다. 이력에는 규칙별 합계와 함께 잠근 파일별 값 전체(values)를 남긴다. */
export function applyRelock({ root, id, current, plan, request, commit, now }) {
  const stored = { schema: BASELINE_SCHEMA, check: id, lockedAt: now, commit, values: current }
  writeInside(root, baselinePath(id), `${JSON.stringify(stored, null, 2)}\n`)
  const entry = {
    at: now,
    check: id,
    reason: request.reason.trim(),
    decision: plan.increased ? request.decision : null,
    commit,
    increased: plan.increased,
    before: plan.before,
    after: plan.after,
    values: current,
  }
  appendInside(root, RELOCK_LOG_PATH, `${JSON.stringify(entry)}\n`)
}

/** --moves 로 받은 파일을 읽는다. 모양이 [{ from, to: [...] }] 가 아니면 null 이다. */
export function readMoves(file) {
  if (!existsSync(file)) return null
  const moves = JSON.parse(readFileSync(file, 'utf8'))
  const isMove = (move) => typeof move?.from === 'string' && Array.isArray(move?.to) && move.to.every((target) => typeof target === 'string')
  return Array.isArray(moves) && moves.every(isMove) ? moves : null
}
