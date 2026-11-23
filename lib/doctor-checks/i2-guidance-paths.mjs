// I2 — 지침 파일에 한 머신에서만 통하는 경로(사용자 폴더 · 볼륨 · 드라이브)나 localhost 포트가 있는지 본다.
// 부르는 곳: index.mjs.
// 먼저 읽을 파일: ../../kit/checks/guidance/rules.mjs 의 findMachineBoundPaths.
import { findMachineBoundPaths } from '../../kit/checks/guidance/rules.mjs'
import { locate, readGuidanceDocs } from './guidance-docs.mjs'
import { joinShort, ok, warn } from './result.mjs'

export const meta = { id: 'I2', title: 'doctor.I2.title' }

export function check(ctx) {
  const found = readGuidanceDocs(ctx.root).docs.flatMap(findMachineBoundPaths)
  if (found.length === 0) return ok(ctx.t('doctor.I2.ok'))
  return warn(ctx.t('doctor.I2.found', { lines: joinShort(found.map(locate)) }), ctx.t('doctor.I2.fix'))
}
