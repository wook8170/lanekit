// 설정 읽기와 검증 — lanekit.config.json 을 찾아 읽고, 스키마에 맞는지 보고, 기본값을 채운다.
// 부르는 곳: gate.mjs(실행 전), 플러그인 쪽 doctor(설정 점검).
// 먼저 읽을 파일: schema.mjs(받는 키와 기본값).
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CONFIG_SCHEMA } from './schema.mjs'

export const CONFIG_FILE = 'lanekit.config.json'

/** 설정 오류. 게이트는 이 오류를 종료 코드 2 로 바꾼다. problems 는 [{ path, code, expected, got }] 다. */
export class ConfigError extends Error {
  constructor(problems, lang = 'ko') {
    super(problems.map((problem) => `${problem.code} ${problem.path ?? ''}`.trim()).join('; '))
    this.name = 'ConfigError'
    this.problems = problems
    this.lang = lang
  }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const joinPath = (path, key) => (path ? `${path}.${key}` : String(key))
const describe = (value) => JSON.stringify(value)?.slice(0, 60) ?? String(value)

function defaultOf(node) {
  if (node.kind !== 'record') return structuredClone(node.fallback)
  return Object.fromEntries(Object.entries(node.keys).map(([key, child]) => [key, defaultOf(child)]))
}

function wrongType(node, value, path, expected, problems) {
  problems.push({ path, code: 'wrong-type', expected, got: describe(value) })
  return defaultOf(node)
}

function resolveRecord(node, value, path, problems) {
  if (!isPlainObject(value)) return wrongType(node, value, path, 'object', problems)
  const known = Object.keys(node.keys)
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) problems.push({ path: joinPath(path, key), code: 'unknown-key', expected: known.join(' | ') })
  }
  for (const key of node.required) {
    if (value[key] === undefined) problems.push({ path: joinPath(path, key), code: 'missing-key' })
  }
  return Object.fromEntries(
    known.map((key) => [key, resolveNode(node.keys[key], value[key], joinPath(path, key), problems)]),
  )
}

function resolveList(node, value, path, problems) {
  if (!Array.isArray(value)) return wrongType(node, value, path, 'array', problems)
  return value.map((item, index) => resolveNode(node.item, item ?? null, joinPath(path, index), problems))
}

function resolveDict(node, value, path, problems) {
  if (!isPlainObject(value)) return wrongType(node, value, path, 'object', problems)
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, resolveNode(node.item, item ?? null, joinPath(path, key), problems)]),
  )
}

function resolveChoice(node, value, path, problems) {
  if (node.options.includes(value)) return value
  problems.push({ path, code: 'not-allowed', expected: node.options.join(' | '), got: describe(value) })
  return node.fallback
}

function resolveCount(node, value, path, problems) {
  if (Number.isInteger(value) && value >= 0) return value
  return wrongType(node, value, path, 'integer >= 0', problems)
}

const RESOLVERS = {
  record: resolveRecord,
  list: resolveList,
  dict: resolveDict,
  choice: resolveChoice,
  count: resolveCount,
  text: (node, value, path, problems) =>
    typeof value === 'string' ? value : wrongType(node, value, path, 'string', problems),
  flag: (node, value, path, problems) =>
    typeof value === 'boolean' ? value : wrongType(node, value, path, 'boolean', problems),
}

function resolveNode(node, value, path, problems) {
  if (value === undefined) return defaultOf(node)
  return RESOLVERS[node.kind](node, value, path, problems)
}

/** 순수 판정. 읽은 값을 스키마에 견주어, 기본값을 채운 설정과 문제 목록을 돌려준다. */
export function validateConfig(raw) {
  const problems = []
  const config = resolveNode(CONFIG_SCHEMA, raw, '', problems)
  return { config, problems }
}

/** startDir 에서 위로 올라가며 설정 파일이 있는 첫 폴더를 찾는다. 없으면 null 이다. */
export function findRoot(startDir) {
  let current = startDir
  while (true) {
    if (existsSync(join(current, CONFIG_FILE))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function parseConfigText(source) {
  try {
    return JSON.parse(source)
  } catch (error) {
    throw new ConfigError([{ path: CONFIG_FILE, code: 'invalid-json', got: error.message }])
  }
}

/** 설정을 읽어 기본값을 채운 객체로 돌려준다. 스키마에 맞지 않으면 ConfigError 를 던진다. */
export function loadConfig(root) {
  const file = join(root, CONFIG_FILE)
  if (!existsSync(file)) throw new ConfigError([{ path: CONFIG_FILE, code: 'config-not-found' }])
  const raw = parseConfigText(readFileSync(file, 'utf8'))
  const { config, problems } = validateConfig(raw)
  if (problems.length > 0) throw new ConfigError(problems, raw?.lang === 'en' ? 'en' : 'ko')
  return config
}

/** 검사의 실제 모드. exposure 의 auto 는 공개 저장소면 fail, 아니면 off 다. */
export function effectiveMode(config, id) {
  const declared = config.checks[id].mode
  if (declared !== 'auto') return declared
  return config.repo.visibility === 'public' ? 'fail' : 'off'
}
