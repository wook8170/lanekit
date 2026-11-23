// 레인키퍼와 잇는 값 — .lanekeeper/config.json 에 넣을 게이트 명령 · 출하 관문 · 레인 커밋 · 경로를 만들고, 빠진 칸만 채운다.
// 부르는 곳: init.mjs(레인키퍼 init 뒤에 채우기, 이미 있으면 제안으로 보여 주기), doctor-checks/ 의 G · W 항목.
// 먼저 읽을 파일: init.mjs 의 linkLanekeeper(이 값을 쓰는 순서).
import { join } from 'node:path'
import { isPlainObject, readJsonFile } from './json-file.mjs'

export const LANEKEEPER_CONFIG = '.lanekeeper/config.json'
export const GATE_LIGHT = 'node scripts/lanekit/gate.mjs --profile light'
export const GATE_FULL = 'node scripts/lanekit/gate.mjs --profile full'
const STANDARDS_ANCHOR = { ko: 'AGENTS.md#코드-작성-기준', en: 'AGENTS.md#code-standards' }

/** lanekit 이 레인키퍼 설정에 넣는 값. 레인 커밋은 레인키퍼의 값 이름을 그대로 쓴다. */
export function lanekeeperValues(lang) {
  return {
    gate: { command: GATE_LIGHT },
    code_standards: { doc: STANDARDS_ANCHOR[lang], checks: ['node scripts/lanekit/gate.mjs --only structure'] },
    release: { gates: [{ name: 'lanekit-full', command: GATE_FULL, required: true }] },
    lanes: { commit: 'allowed' },
    paths: { lane_reports: '.lanekit/reports/{lane}.md', decisions: 'docs/decisions/{date}-{slug}.md' },
  }
}

const isEmpty = (value) => value === undefined || value === '' || (Array.isArray(value) && value.length === 0)

/** 순수 함수. current 에 없는 칸만 additions 에서 채운다. 이미 값이 있는 칸은 그대로 둔다. */
export function fillMissing(current, additions) {
  const filled = { ...current }
  for (const [key, addition] of Object.entries(additions)) {
    const existing = filled[key]
    if (isPlainObject(addition) && (isPlainObject(existing) || isEmpty(existing))) {
      filled[key] = fillMissing(isPlainObject(existing) ? existing : {}, addition)
    } else if (isEmpty(existing)) {
      filled[key] = addition
    }
  }
  return filled
}

/** 레인키퍼 프로젝트 설정을 읽는다. 없거나 깨졌으면 null 이다. */
export function readLanekeeperConfig(root) {
  const { value } = readJsonFile(join(root, LANEKEEPER_CONFIG))
  return isPlainObject(value) ? value : null
}

/** 레인키퍼 init 에 넘길 인자. 워크트리 훅은 lanekit 이 켜지 않는다. */
export function lanekeeperInitArgs({ kind, lang }) {
  return ['init', '--kind', kind, '--lang', lang, '--gate', GATE_LIGHT, '--worktree-hook', 'no']
}
