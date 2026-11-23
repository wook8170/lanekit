// 바깥 명령 실행 — 명령을 돌려 종료 코드와 출력을 돌려준다. 명령이 없어도 던지지 않고 코드 127 로 알린다.
// 부르는 곳: init.mjs(게이트 · 레인키퍼 init · git 설정), doctor.mjs(점검 항목이 쓰는 run).
// 먼저 읽을 파일: doctor-context.mjs(테스트가 이 함수를 가짜로 바꾸는 곳).
import { spawnSync } from 'node:child_process'
import { resolveCommand } from '../kit/lib/exec.mjs'
import { planSpawn } from '../kit/lib/platform.mjs'

export const COMMAND_NOT_FOUND = 127

/** { code, stdout, stderr } 를 돌려준다. 명령을 찾지 못했거나 신호로 끝났으면 code 는 127 이다. */
export function runCommand(command, args, { cwd, env } = {}) {
  const plan = planSpawn(resolveCommand(command, env), args)
  const result = spawnSync(plan.command, plan.args, { cwd, env, encoding: 'utf8', shell: plan.shell })
  if (result.error || result.status === null) return { code: COMMAND_NOT_FOUND, stdout: '', stderr: result.error?.message ?? '' }
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}
