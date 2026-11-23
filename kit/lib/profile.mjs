// 프로필마다 돌릴 검사 고르기 — 프로필 · --only · --skip · 모드로 검사마다 「돌린다 · 건너뛴다」를 정한다.
// 부르는 곳: gate.mjs(실행 전 계획).
// 먼저 읽을 파일: registry.mjs(검사 목록이 어디서 오는가).
import { effectiveMode } from './config.mjs'

export const PROFILES = ['light', 'changed', 'full']

/** 순수 판정. 건너뛰는 까닭을 순서대로 본다: 고르지 않음 → 플래그 → 모드 off → 프로필 밖. */
function planOne(check, { config, profile, only, skip }) {
  const mode = effectiveMode(config, check.id)
  const step = { id: check.id, mode, check }
  if (only.length > 0 && !only.includes(check.id)) return { ...step, action: 'skip', reason: 'not-selected' }
  if (skip.includes(check.id)) return { ...step, action: 'skip', reason: 'skipped-by-flag' }
  if (mode === 'off') return { ...step, action: 'skip', reason: 'mode-off' }
  if (check.installed && !check.meta.profiles.includes(profile)) return { ...step, action: 'skip', reason: 'not-in-profile' }
  return { ...step, action: 'run' }
}

/** 검사마다 { id, mode, action, reason, check } 를 돌려준다. 파일이 없는 검사는 「돌린다」로 남아 실행 단계에서 오류가 된다. */
export function planChecks(selection) {
  return selection.checks.map((check) => planOne(check, selection))
}

/** --only · --skip 에 적힌 ID 가운데 등록표에 없는 것. */
export function unknownIds(checks, ids) {
  const known = checks.map((check) => check.id)
  return ids.filter((id) => !known.includes(id))
}
