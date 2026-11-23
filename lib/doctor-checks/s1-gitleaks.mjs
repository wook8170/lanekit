// S1 — gitleaks 가 설치돼 있는지 본다. 없으면 비밀값 검사가 내장 규칙으로 대신한다.
// 부르는 곳: index.mjs.
// 먼저 읽을 파일: 없음(명령 하나를 돌려 본다).
import { ok, warn } from './result.mjs'

export const meta = { id: 'S1', title: 'doctor.S1.title' }

export function check(ctx) {
  if (ctx.run('gitleaks', ['version']).code === 0) return ok(ctx.t('doctor.S1.ok'))
  return warn(ctx.t('doctor.S1.absent'), ctx.t('doctor.S1.fix'))
}
