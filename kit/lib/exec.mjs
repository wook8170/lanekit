// 외부 명령 실행 — 실행 파일을 PATH 에서 찾고, 명령을 돌려 종료 코드와 출력을 돌려준다. 예외를 던지지 않는다.
// 부르는 곳: 검사(secrets · audit · sbom · tests · docs-drift 의 command 원천).
// 먼저 읽을 파일: ../checks/tests/run.mjs(가장 단순하게 쓰는 예).
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { WINDOWS, executableNames, pathListSeparator, planSpawn } from './platform.mjs'

const MAX_OUTPUT_BYTES = 256 * 1024 * 1024

/** PATH 에서 실행 파일을 찾아 절대 경로를 돌려준다. 없으면 null 이다. */
export function findExecutable(name, env = process.env, platform = process.platform) {
  const dirs = (env.PATH ?? env.Path ?? '').split(pathListSeparator(platform)).filter(Boolean)
  const names = executableNames(name, env, platform)
  return dirs.flatMap((dir) => names.map((candidate) => join(dir, candidate))).find((candidate) => existsSync(candidate)) ?? null
}

function toOutcome(spawned) {
  return {
    code: spawned.status,
    stdout: spawned.stdout ?? '',
    stderr: spawned.stderr ?? '',
    // 종료 코드가 없으면 명령이 시작되지 못했거나 신호로 끝난 것이다.
    failedToStart: spawned.status === null,
    startError: spawned.error?.message ?? '',
  }
}

/**
 * Windows 에서 이름만 받은 명령(`npm` · `claude`)을 PATH 에서 찾은 파일로 바꾼다. 그 밖에는 받은 그대로 돌려준다.
 * Windows 는 확장자 없는 이름으로 `.exe` 만 찾는다. `.cmd` 로 깔린 명령은 찾은 경로를 줘야 실행된다.
 */
export function resolveCommand(command, env = process.env, platform = process.platform) {
  if (platform !== WINDOWS || /[\\/]/.test(command)) return command
  return findExecutable(command, env, platform) ?? command
}

/**
 * 실행 파일과 인자로 돌린다. 돌려주는 값은 { code, stdout, stderr, failedToStart, startError } 다.
 * Windows 의 배치 파일(.cmd · .bat)은 셸을 거쳐 돌린다. 경로와 인자를 감싸는 일은 platform.mjs 의 planSpawn 이 한다.
 */
export function runTool(file, args, { cwd, timeoutMs } = {}) {
  const plan = planSpawn(file, args)
  return toOutcome(spawnSync(plan.command, plan.args, { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, shell: plan.shell }))
}

/** 셸 명령 한 줄을 돌린다. 프로젝트 설정에 적힌 명령에 쓴다. */
export function runShell(command, { cwd, timeoutMs } = {}) {
  return toOutcome(spawnSync(command, { cwd, shell: true, encoding: 'utf8', timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES }))
}
