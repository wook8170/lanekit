// K4 — ratchet 모드인 검사에 기준선이 있는지, 기준선이 너무 오래되지 않았는지 본다.
// 부르는 곳: index.mjs.
// 먼저 읽을 파일: ../../kit/lib/baseline.mjs 의 readBaseline.
import { readBaseline } from '../../kit/lib/baseline.mjs'
import { ConfigError, effectiveMode } from '../../kit/lib/config.mjs'
import { CHECK_IDS } from '../../kit/lib/schema.mjs'
import { readProjectConfig } from '../project-config.mjs'
import { fail, ok, warn } from './result.mjs'

export const MAX_BASELINE_AGE_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000
export const meta = { id: 'K4', title: 'doctor.K4.title' }

// 깨진 기준선 파일은 「없음」과 같이 다룬다. 게이트가 같은 파일에서 설정 오류로 끝나기 때문이다.
function readBaselineOrNull(root, id) {
  try {
    return readBaseline(root, id)
  } catch (error) {
    if (!(error instanceof ConfigError) && !(error instanceof SyntaxError)) throw error
    return null
  }
}

/** 순수 판정. 기준선이 잠긴 뒤 지난 날 수. 시각을 읽을 수 없으면 무한대로 본다. */
export function baselineAgeDays(lockedAt, now) {
  const lockedTime = Date.parse(lockedAt)
  return Number.isNaN(lockedTime) ? Number.POSITIVE_INFINITY : (now.getTime() - lockedTime) / DAY_MS
}

export function check(ctx) {
  const { config } = readProjectConfig(ctx.root)
  const ratcheted = CHECK_IDS.filter((id) => effectiveMode(config, id) === 'ratchet')
  if (ratcheted.length === 0) return ok(ctx.t('doctor.K4.none'))
  const baselines = ratcheted.map((id) => ({ id, baseline: readBaselineOrNull(ctx.root, id) }))
  const unlocked = baselines.filter((entry) => !entry.baseline).map((entry) => entry.id)
  if (unlocked.length > 0) return fail(ctx.t('doctor.K4.absent', { checks: unlocked.join(', ') }), ctx.t('doctor.K4.fix-lock'))
  const stale = baselines.filter((entry) => baselineAgeDays(entry.baseline.lockedAt, ctx.now()) > MAX_BASELINE_AGE_DAYS)
  if (stale.length === 0) return ok(ctx.t('doctor.K4.ok', { checks: ratcheted.join(', ') }))
  const vars = { checks: stale.map((entry) => entry.id).join(', '), days: MAX_BASELINE_AGE_DAYS }
  return warn(ctx.t('doctor.K4.stale', vars), ctx.t('doctor.K4.fix-relock'))
}
