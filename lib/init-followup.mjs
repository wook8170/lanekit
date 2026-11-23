// init 이 파일을 쓴 뒤에 하는 일 — 레인키퍼 연결, git 훅 폴더 설정, 게이트 첫 실행, 기준선 잠금. 단계마다 결과 한 덩어리를 돌려준다.
// 부르는 곳: init.mjs.
// 먼저 읽을 파일: lanekeeper-link.mjs(레인키퍼에 넣는 값), ../kit/gate.mjs(게이트 인자).
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { KIT_TARGET } from './kit-source.mjs'
import { LANEKEEPER_CONFIG, fillMissing, lanekeeperInitArgs, lanekeeperValues, readLanekeeperConfig } from './lanekeeper-link.mjs'
import { COMMAND_NOT_FOUND } from './process.mjs'
import { isBlockedPath, writeInside } from '../kit/lib/safe-write.mjs'
import { HOOK_TARGET, SUGGESTIONS_DIR } from './template-map.mjs'

const GATE_SCRIPT = `${KIT_TARGET}/gate.mjs`
const toJson = (value) => `${JSON.stringify(value, null, 2)}\n`

// 쓴 결과를 돌려준다. 경로가 심볼릭 링크이거나 저장소 밖을 가리키면 쓰지 않고 outcome 을 blocked 로 바꾼다.
function writeJson(root, { outcome, path }, value) {
  if (isBlockedPath(root, path)) return { outcome: 'blocked', path }
  writeInside(root, path, toJson(value))
  return { outcome, path }
}

// 레인키퍼 설정이 없으면 레인키퍼의 init 으로 만든다. 명령이 없는 머신에서는 만들지 않는다.
function createLanekeeperConfig({ root, exec, answers }) {
  const created = exec('lanekeeper-config', lanekeeperInitArgs(answers))
  if (created.code === COMMAND_NOT_FOUND) return 'unavailable'
  return existsSync(join(root, LANEKEEPER_CONFIG)) ? 'created' : 'failed'
}

/**
 * 레인키퍼 설정에 게이트 명령과 출하 관문을 잇는다. outcome 은 다음 가운데 하나다.
 * created(레인키퍼 init 이 만든 파일에 채웠다) · linked(이미 값이 다 있다) · suggested(있는 파일은 건드리지 않고 제안으로 둔다)
 * · unavailable(레인키퍼가 없어 건너뛰고 제안으로 둔다) · failed(레인키퍼 init 이 파일을 만들지 못했다)
 * · blocked(쓸 경로가 심볼릭 링크이거나 저장소 밖을 가리켜 쓰지 않았다).
 */
export function linkLanekeeper({ root, exec, answers }) {
  const values = lanekeeperValues(answers.lang)
  const suggestionPath = `${SUGGESTIONS_DIR}/${LANEKEEPER_CONFIG}`
  const before = readLanekeeperConfig(root)
  if (before) {
    const filled = fillMissing(before, values)
    if (toJson(filled) === toJson(before)) return { outcome: 'linked', path: LANEKEEPER_CONFIG }
    return writeJson(root, { outcome: 'suggested', path: suggestionPath }, filled)
  }
  const outcome = createLanekeeperConfig({ root, exec, answers })
  if (outcome !== 'created') return writeJson(root, { outcome, path: suggestionPath }, values)
  return writeJson(root, { outcome, path: LANEKEEPER_CONFIG }, fillMissing(readLanekeeperConfig(root) ?? {}, values))
}

/**
 * git 이 .githooks 를 훅 폴더로 쓰게 한다. 훅 파일을 놓지 않았으면 하지 않는다.
 * 이미 다른 훅 폴더를 쓰는 저장소(예: 훅 관리 도구)는 바꾸지 않는다. 바꾸면 그 저장소의 기존 훅이 돌지 않는다.
 */
export function setHooksPath({ root, exec }) {
  if (!existsSync(join(root, HOOK_TARGET))) return { outcome: 'no-hook' }
  const hooksDir = dirname(HOOK_TARGET)
  const existing = exec('git', ['config', '--get', 'core.hooksPath'])
  const existingDir = existing.code === 0 ? existing.stdout.trim() : ''
  if (existingDir && existingDir !== hooksDir) return { outcome: 'conflict', existing: existingDir }
  const configured = exec('git', ['config', 'core.hooksPath', hooksDir])
  return { outcome: configured.code === 0 ? 'set' : 'failed' }
}

/** light 프로필 게이트를 한 번 돌려 지금 값을 보여 준다. 실패해도 init 은 이어 간다. */
export function runLightGate({ exec }) {
  return exec(process.execPath, [GATE_SCRIPT, '--profile', 'light'])
}

/** 기준선을 잠근다. 모드는 바꾸지 않는다. ratchet 으로 올리는 일은 사용자가 설정에서 한다. */
export function lockBaselines({ exec }) {
  return exec(process.execPath, [GATE_SCRIPT, '--relock', 'all', '--reason', 'init'])
}
