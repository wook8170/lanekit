// P3 — 개인 설정의 훅에 레인키퍼와 겹치는 세션 가드가 남아 있는지 본다. 남아 있으면 같은 일이 두 번 돈다.
// 부르는 곳: index.mjs.
// 먼저 읽을 파일: ../claude-home.mjs 의 readPersonalHookCommands.
import { readPersonalHookCommands } from '../claude-home.mjs'
import { ok, warn } from './result.mjs'

export const SESSION_GUARDS = ['auto-retry', 'handoff-guard', 'terse']
export const meta = { id: 'P3', title: 'doctor.P3.title' }

export function check(ctx) {
  const commands = readPersonalHookCommands(ctx)
  const duplicated = SESSION_GUARDS.filter((name) => commands.some((command) => command.includes(name)))
  if (duplicated.length === 0) return ok(ctx.t('doctor.P3.ok'))
  return warn(ctx.t('doctor.P3.duplicated', { guards: duplicated.join(', ') }), ctx.t('doctor.P3.fix'))
}
