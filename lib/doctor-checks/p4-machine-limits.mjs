// P4 — 레인키퍼의 머신 설정 파일(부하 · 슬롯 기준)이 있는지 본다. lanekit 은 이 값을 읽기만 한다.
// 부르는 곳: index.mjs.
// 먼저 읽을 파일: ../claude-home.mjs 의 lanekeeperHome.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { lanekeeperHome } from '../claude-home.mjs'
import { ok, warn } from './result.mjs'

export const meta = { id: 'P4', title: 'doctor.P4.title' }

export function check(ctx) {
  if (existsSync(join(lanekeeperHome(ctx), 'machine.json'))) return ok(ctx.t('doctor.P4.ok'))
  return warn(ctx.t('doctor.P4.absent'), ctx.t('doctor.P4.fix'))
}
