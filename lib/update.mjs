// update 명령 — 복사본을 설치된 lanekit 의 원본으로 바꾼다. 원본 그대로인 파일만 바꾸고, 프로젝트가 고친 파일은 목록으로 낸다.
// 부르는 곳: cli.mjs(`lanekit update`). 고친 파일을 덮어쓸지는 skills/update 가 묻고 --force 로 넘긴다.
// 먼저 읽을 파일: update-plan.mjs(파일마다 할 일을 정하는 판정).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { findRoot } from '../kit/lib/config.mjs'
import { FlagError, parseFlags, splitList } from './flags.mjs'
import { KIT_TARGET, hashesOf, readKitSources } from './kit-source.mjs'
import { LOCK_FILE, LOCK_SCHEMA, hashTree, readLock, serializeLock } from './lock.mjs'
import { readProjectConfig } from './project-config.mjs'
import { isBlockedPath, removeInside, writeInside } from '../kit/lib/safe-write.mjs'
import { REMOVING_ACTIONS, WRITING_ACTIONS, groupByAction, hasChanges, planUpdate } from './update-plan.mjs'

const FLAGS = { '--yes': 'switch', '--force': 'value' }
export const UPDATE_SUGGESTIONS_DIR = '.lanekit/update-suggestions'
const SHOWN_ACTIONS = ['add', 'restore', 'replace', 'overwrite', 'remove', 'conflict', 'orphan']

// 계획의 한 줄이 쓰거나 지우는 경로(저장소 루트 기준). 고친 파일(conflict)은 복사본이 아니라 제안 폴더에 새 원본을 둔다.
function touchedPath({ path, action }) {
  if (WRITING_ACTIONS.includes(action) || REMOVING_ACTIONS.includes(action)) return `${KIT_TARGET}/${path}`
  return action === 'conflict' ? `${UPDATE_SUGGESTIONS_DIR}/${path}` : null
}

/** 순수 함수. 계획이 쓰거나 지우는 모든 경로. 잠금 파일도 든다. */
export function listTouchedPaths(actions) {
  return [...actions.map(touchedPath).filter(Boolean), `${KIT_TARGET}/${LOCK_FILE}`]
}

/** 계획대로 복사본을 바꾼다. 고친 파일(conflict)의 새 원본은 제안 폴더에 두어 사용자가 견줄 수 있게 한다. */
export function applyUpdate({ root, actions, sources, version }) {
  const sourceOf = Object.fromEntries(sources.map((source) => [source.path, source]))
  for (const entry of actions) {
    const target = touchedPath(entry)
    if (target === null) continue
    if (REMOVING_ACTIONS.includes(entry.action)) removeInside(root, target)
    else writeInside(root, target, sourceOf[entry.path].content, { executable: sourceOf[entry.path].executable })
  }
  writeInside(root, `${KIT_TARGET}/${LOCK_FILE}`, serializeLock({ schema: LOCK_SCHEMA, version, files: hashesOf(sources) }))
}

/** 순수 함수. 동작별로 파일을 늘어놓는다. 바뀌지 않는 파일(current)은 수만 낸다. */
export function formatUpdatePlan(actions, versions, translate) {
  const groups = groupByAction(actions)
  const sections = SHOWN_ACTIONS.filter((action) => groups[action]).flatMap((action) => [
    translate(`update.action.${action}`, { count: groups[action].length }),
    ...groups[action].map((path) => `  ${path}`),
  ])
  return [translate('update.heading', versions), ...sections, translate('update.current', { count: groups.current?.length ?? 0 })]
}

function readPlan({ root, pluginRoot, force }) {
  const kitDir = join(root, KIT_TARGET)
  const lock = existsSync(kitDir) ? readLock(kitDir) : null
  if (!lock) return null
  const kit = readKitSources(pluginRoot, readProjectConfig(root).config.modules)
  const actions = planUpdate({ locked: lock.files, actual: hashTree(kitDir), incoming: hashesOf(kit.files) }, force)
  return { lock, kit, actions }
}

/** 하위 명령의 진입 함수. --yes 가 없으면 계획만 보여 준다. 종료 코드: 0 끝남 · 2 복사본이 없거나, 인자가 틀리거나, 쓸 경로가 막혔다. */
export async function run({ argv, cwd, write, t: translate, pluginRoot, version }) {
  try {
    const flags = parseFlags(argv, FLAGS)
    const root = findRoot(cwd) ?? cwd
    const planned = readPlan({ root, pluginRoot, force: splitList(flags.force) })
    if (!planned) {
      write(`${translate('update.no-lock')}\n`)
      return 2
    }
    const lines = formatUpdatePlan(planned.actions, { from: planned.lock.version, to: version }, translate)
    const notices = planned.kit.missingModules.map((name) => translate('init.module-missing', { name }))
    write(`${[...lines, ...notices].join('\n')}\n`)
    const isPending = hasChanges(planned.actions) || planned.lock.version !== version
    const blocked = isPending ? listTouchedPaths(planned.actions).filter((path) => isBlockedPath(root, path)) : []
    if (blocked.length > 0) {
      write(`${[...blocked.map((path) => translate('init.blocked', { path })), translate('update.blocked')].join('\n')}\n`)
      return 2
    }
    if (!isPending) write(`${translate('update.up-to-date')}\n`)
    else if (!flags.yes) write(`${translate('update.dry-run')}\n`)
    else {
      applyUpdate({ root, actions: planned.actions, sources: planned.kit.files, version })
      write(`${translate('update.done', { version })}\n`)
    }
    if (planned.actions.some(({ action }) => action === 'conflict')) write(`${translate('update.conflict-hint', { dir: UPDATE_SUGGESTIONS_DIR })}\n`)
    return 0
  } catch (error) {
    if (!(error instanceof FlagError)) throw error
    write(`${translate(`cli.${error.code}`, { flag: error.flag })}\n`)
    return 2
  }
}
