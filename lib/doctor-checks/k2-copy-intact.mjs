// K2 — 복사본(scripts/lanekit/)이 잠금 파일과 같은지 본다. 고친 파일은 경고로, 빠진 파일은 실패로 알린다.
// 부르는 곳: index.mjs.
// 먼저 읽을 파일: ../lock.mjs 의 compareWithLock.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { KIT_TARGET } from '../kit-source.mjs'
import { compareWithLock } from '../lock.mjs'
import { fail, joinShort, ok, warn } from './result.mjs'

export const meta = { id: 'K2', title: 'doctor.K2.title' }

export function check(ctx) {
  const kitDir = join(ctx.root, KIT_TARGET)
  const comparison = existsSync(kitDir) ? compareWithLock(kitDir) : null
  if (!comparison) return fail(ctx.t('doctor.K2.no-lock'), ctx.t('doctor.K2.fix-init'))
  if (comparison.missing.length > 0) {
    return fail(ctx.t('doctor.K2.missing', { files: joinShort(comparison.missing) }), ctx.t('doctor.K2.fix-update'))
  }
  if (comparison.modified.length > 0) {
    return warn(ctx.t('doctor.K2.modified', { files: joinShort(comparison.modified) }), ctx.t('doctor.K2.fix-modified'))
  }
  return ok(ctx.t('doctor.K2.ok', { count: comparison.same.length }))
}
