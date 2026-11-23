// G2 — 레인키퍼의 출하 관문에 full 프로필 게이트가 등록돼 있는지 본다.
// 부르는 곳: index.mjs.
// 먼저 읽을 파일: ../lanekeeper-link.mjs(init 이 넣는 값).
import { readLanekeeperConfig } from '../lanekeeper-link.mjs'
import { ok, warn } from './result.mjs'

export const meta = { id: 'G2', title: 'doctor.G2.title' }

const isFullGate = (gate) => /gate\.mjs/.test(gate?.command ?? '') && /--profile\s+full/.test(gate?.command ?? '')

export function check(ctx) {
  const gates = readLanekeeperConfig(ctx.root)?.release?.gates
  if (Array.isArray(gates) && gates.some(isFullGate)) return ok(ctx.t('doctor.G2.ok'))
  return warn(ctx.t('doctor.G2.absent'), ctx.t('doctor.G2.fix'))
}
