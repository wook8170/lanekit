// G1 — 레인키퍼 설정의 게이트 명령이 lanekit 의 게이트 실행기를 부르는지 본다.
// 부르는 곳: index.mjs.
// 먼저 읽을 파일: ../lanekeeper-link.mjs(init 이 넣는 값).
import { readLanekeeperConfig } from '../lanekeeper-link.mjs'
import { ok, warn } from './result.mjs'

export const meta = { id: 'G1', title: 'doctor.G1.title' }

export function check(ctx) {
  const lanekeeper = readLanekeeperConfig(ctx.root)
  if (!lanekeeper) return warn(ctx.t('doctor.G1.no-config'), ctx.t('doctor.G1.fix-init'))
  const command = lanekeeper.gate?.command ?? ''
  if (String(command).includes('gate.mjs')) return ok(ctx.t('doctor.G1.ok'))
  return warn(ctx.t('doctor.G1.other', { command: command || '-' }), ctx.t('doctor.G1.fix'))
}
