// P1 — 레인키퍼와 wook-skills 가 설치되고 켜져 있는지 본다.
// 부르는 곳: index.mjs.
// 먼저 읽을 파일: ../claude-home.mjs 의 readPluginState.
import { readPluginState } from '../claude-home.mjs'
import { fail, ok } from './result.mjs'

export const REQUIRED_PLUGINS = ['lanekeeper', 'wook-skills']
export const meta = { id: 'P1', title: 'doctor.P1.title' }

export function check(ctx) {
  const states = REQUIRED_PLUGINS.map((name) => ({ name, ...readPluginState(ctx, name) }))
  const absent = states.filter((state) => !state.installed || !state.enabled).map((state) => state.name)
  if (absent.length === 0) return ok(ctx.t('doctor.P1.ok'))
  return fail(ctx.t('doctor.P1.absent', { plugins: absent.join(', ') }), ctx.t('doctor.P1.fix', { plugins: absent.join(' ') }))
}
