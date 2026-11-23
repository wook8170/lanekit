// P2 — 두 플러그인의 버전이 lanekit 이 기대하는 최소 버전 이상인지 본다.
// 부르는 곳: index.mjs.
// 먼저 읽을 파일: ../claude-home.mjs 의 compareVersions.
import { compareVersions, readPluginState } from '../claude-home.mjs'
import { ok, skip, warn } from './result.mjs'

export const MIN_VERSIONS = { lanekeeper: '0.2.7', 'wook-skills': '0.1.2' }
export const meta = { id: 'P2', title: 'doctor.P2.title' }

export function check(ctx) {
  const states = Object.keys(MIN_VERSIONS).map((name) => ({ name, ...readPluginState(ctx, name) }))
  const known = states.filter((state) => state.installed && state.version)
  if (known.length === 0) return skip(ctx.t('doctor.P2.unknown'))
  const outdated = known.filter((state) => compareVersions(state.version, MIN_VERSIONS[state.name]) < 0)
  if (outdated.length === 0) return ok(ctx.t('doctor.P2.ok'))
  const list = outdated.map((state) => `${state.name} ${state.version} < ${MIN_VERSIONS[state.name]}`).join(', ')
  return warn(ctx.t('doctor.P2.outdated', { list }), ctx.t('doctor.P2.fix'))
}
