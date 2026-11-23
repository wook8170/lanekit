// 개인 설정 폴더 읽기 — Claude Code 의 플러그인 설치 기록 · 훅 설정 · 메모리 폴더와 레인키퍼의 개인 설정을 찾는다. 읽기만 한다.
// 부르는 곳: init.mjs(언어 기본값), doctor-checks/ 의 P · I4 항목.
// 먼저 읽을 파일: doctor-context.mjs(home · env 를 넘겨받는 곳).
import { join } from 'node:path'
import { isPlainObject, readJsonOr } from './json-file.mjs'

export const claudeDir = ({ home, env }) => env.CLAUDE_CONFIG_DIR || join(home, '.claude')
export const lanekeeperHome = ({ home, env }) => env.LANEKEEPER_HOME || join(home, '.lanekeeper')

/** 레인키퍼 개인 설정의 언어. 값이 ko · en 이 아니면 undefined 다. */
export function readPersonalLanguage(machine) {
  const language = readJsonOr(join(lanekeeperHome(machine), 'personal.json'), {})?.language
  return ['ko', 'en'].includes(language) ? language : undefined
}

function readSettings(machine) {
  const settings = readJsonOr(join(claudeDir(machine), 'settings.json'), {})
  return isPlainObject(settings) ? settings : {}
}

/**
 * 플러그인 하나의 설치 상태 { installed, enabled, version }.
 * 설치 기록의 키는 `<이름>@<마켓플레이스>` 다. 켜짐 표시가 false 일 때만 꺼진 것으로 본다.
 */
export function readPluginState(machine, name) {
  const record = readJsonOr(join(claudeDir(machine), 'plugins', 'installed_plugins.json'), {})
  const plugins = isPlainObject(record?.plugins) ? record.plugins : {}
  const key = Object.keys(plugins).find((candidate) => candidate.split('@')[0] === name)
  if (!key) return { installed: false, enabled: false, version: null }
  const installs = Array.isArray(plugins[key]) ? plugins[key] : []
  const enabledPlugins = readSettings(machine).enabledPlugins ?? {}
  return { installed: true, enabled: enabledPlugins[key] !== false, version: installs[0]?.version ?? null }
}

function collectCommands(node) {
  if (Array.isArray(node)) return node.flatMap(collectCommands)
  if (!isPlainObject(node)) return []
  const own = typeof node.command === 'string' ? [node.command] : []
  return [...own, ...Object.values(node).flatMap(collectCommands)]
}

/** 개인 설정에 등록된 훅 명령 목록. */
export const readPersonalHookCommands = (machine) => collectCommands(readSettings(machine).hooks ?? {})

/** 이 저장소의 메모리 색인 경로. Claude Code 는 저장소 경로의 글자 · 숫자가 아닌 자리를 '-' 로 바꿔 폴더 이름으로 쓴다. */
export function memoryIndexPath(machine, root) {
  return join(claudeDir(machine), 'projects', root.replace(/[^A-Za-z0-9]/g, '-'), 'memory', 'MEMORY.md')
}

/** 점으로 나눈 버전을 견준다. left 가 작으면 음수, 같으면 0, 크면 양수다. */
export function compareVersions(left, right) {
  const toParts = (version) => String(version).split('.').map((part) => Number.parseInt(part, 10) || 0)
  const [leftParts, rightParts] = [toParts(left), toParts(right)]
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}
