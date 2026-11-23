// K3 — 설치된 lanekit 이 복사본을 만든 버전보다 새로운지 본다.
// 부르는 곳: index.mjs.
// 먼저 읽을 파일: ../lock.mjs 의 readLock.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { compareVersions } from '../claude-home.mjs'
import { KIT_TARGET } from '../kit-source.mjs'
import { readLock } from '../lock.mjs'
import { ok, skip, warn } from './result.mjs'

export const meta = { id: 'K3', title: 'doctor.K3.title' }

export function check(ctx) {
  const kitDir = join(ctx.root, KIT_TARGET)
  const lock = existsSync(kitDir) ? readLock(kitDir) : null
  if (!lock) return skip(ctx.t('doctor.K3.no-lock'))
  const versions = { copied: lock.version, installed: ctx.plugin.version }
  if (compareVersions(versions.installed, versions.copied) > 0) return warn(ctx.t('doctor.K3.newer', versions), ctx.t('doctor.K3.fix'))
  return ok(ctx.t('doctor.K3.ok', versions))
}
