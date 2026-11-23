// 테스트 검사(tests) — 프로젝트의 테스트 명령을 돌리고 종료 코드만 본다. 출력은 .lanekit/reports/ 에 남긴다.
// 부르는 곳: gate.mjs(등록표의 tests. changed 와 full 프로필에서 돈다).
// 먼저 읽을 파일: ../../lib/exec.mjs(명령 실행).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runShell } from '../../lib/exec.mjs'
import { writeInside } from '../../lib/safe-write.mjs'
import { quoteShellArg } from '../../lib/platform.mjs'

export const meta = {
  id: 'tests',
  profiles: ['changed', 'full'],
  defaultMode: 'fail',
  ratchetable: false,
}

const FILES_PLACEHOLDER = '{files}'

/**
 * 순수 판정. 돌릴 명령을 정한다. 돌려주는 값은 { command } 나 { skip: <이유> } 다.
 * changed 프로필에서 바뀐 파일을 모르면(existingChangedFiles 가 null) 전체 명령을 쓴다.
 * 파일 이름은 명령을 돌릴 셸(Windows 는 cmd.exe, 그 밖에는 sh)이 한 낱말로 읽게 감싼다.
 */
export function planCommand({ profile, options, existingChangedFiles, platform = process.platform }) {
  const usesChanged = profile === 'changed' && existingChangedFiles !== null
  const template = usesChanged ? options.changed : options.full
  if (!template) return { skip: 'no-command' }
  if (!usesChanged || !template.includes(FILES_PLACEHOLDER)) return { command: template }
  if (existingChangedFiles.length === 0) return { skip: 'no-changed-files' }
  return { command: template.replaceAll(FILES_PLACEHOLDER, existingChangedFiles.map((file) => quoteShellArg(file, platform)).join(' ')) }
}

function writeLog(root, profile, outcome) {
  const path = `.lanekit/reports/tests-${profile}.log`
  writeInside(root, path, `${outcome.stdout}${outcome.stderr}`)
  return path
}

/** 검사 계약의 run. 지워진 파일은 테스트 명령에 넘기지 않는다. */
export async function run(ctx) {
  const existingChangedFiles = ctx.changedFiles?.filter((file) => existsSync(join(ctx.root, file))) ?? null
  const plan = planCommand({ profile: ctx.profile, options: ctx.config.checks.tests, existingChangedFiles })
  if (plan.skip) return { status: 'skip', summary: ctx.t(`tests.${plan.skip}`), findings: [], metrics: { ran: 0 }, current: null }
  const outcome = runShell(plan.command, { cwd: ctx.root })
  const log = writeLog(ctx.root, ctx.profile, outcome)
  const vars = { code: outcome.code ?? outcome.startError, log }
  if (outcome.code === 0) return { status: 'pass', summary: ctx.t('tests.passed', vars), findings: [], metrics: { ran: 1, exitCode: 0 }, current: null }
  const finding = { file: log, line: null, rule: 'tests-failed', message: ctx.t('tests.failed', vars), value: 1, limit: 0 }
  return { status: 'findings', summary: ctx.t('tests.failed', vars), findings: [finding], metrics: { ran: 1, exitCode: outcome.code ?? -1 }, current: null }
}
