// doctor 명령 — 점검 항목을 차례로 돌려 항목마다 상태와 고치는 법을 낸다. 아무것도 고치지 않는다.
// 부르는 곳: cli.mjs(`lanekit doctor`), init.mjs(마지막 단계).
// 먼저 읽을 파일: doctor-checks/index.mjs(항목 목록), doctor-context.mjs(항목이 받는 ctx).
import { findRoot } from '../kit/lib/config.mjs'
import { createDoctorContext, localMachine } from './doctor-context.mjs'
import { DOCTOR_CHECKS } from './doctor-checks/index.mjs'
import { FlagError, parseFlags } from './flags.mjs'

const FLAGS = { '--json': 'switch' }
const MARKS = { ok: '✓', warn: '!', fail: '✗', skip: '-' }

/** 항목을 모두 돌려 [{ id, title, status, message, fix }] 를 돌려준다. 항목이 던지면 그 항목만 실패로 적는다. */
export async function runChecks(ctx, checks = DOCTOR_CHECKS) {
  const results = []
  for (const { meta, check } of checks) {
    const title = ctx.t(meta.title)
    try {
      results.push({ id: meta.id, title, ...(await check(ctx)) })
    } catch (error) {
      results.push({ id: meta.id, title, status: 'fail', message: ctx.t('doctor.crashed', { error: error.message }), fix: '' })
    }
  }
  return results
}

/** 순수 함수. 상태별 건수 { ok, warn, fail, skip }. */
export function countByStatus(results) {
  const counts = { ok: 0, warn: 0, fail: 0, skip: 0 }
  for (const result of results) counts[result.status] += 1
  return counts
}

/** 순수 함수. 사람이 읽는 출력. 고치는 법은 문제가 있는 항목 아래에만 낸다. */
export function formatResults(results, translate) {
  const lines = results.flatMap((result) => {
    const head = `${MARKS[result.status]} ${result.id.padEnd(3)} ${result.title} — ${result.message}`
    return result.fix ? [head, `      ${translate('doctor.fix-label')} ${result.fix}`] : [head]
  })
  return `${translate('doctor.heading')}\n${lines.join('\n')}\n${translate('doctor.summary', countByStatus(results))}\n`
}

/** 저장소 하나를 점검해 출력하고 종료 코드를 돌려준다: 실패가 있으면 1, 없으면 0. */
export async function runDoctor({ root, translate, pluginRoot, version, write, asJson }, machine) {
  const results = await runChecks(createDoctorContext({ root, translate, pluginRoot, version }, machine))
  write(asJson ? `${JSON.stringify({ root, version, results }, null, 2)}\n` : formatResults(results, translate))
  return results.some((result) => result.status === 'fail') ? 1 : 0
}

/** 하위 명령의 진입 함수. 설정 파일이 있는 폴더를 위로 찾고, 없으면 지금 폴더를 점검한다. */
export async function run({ argv, cwd, write, t: translate, pluginRoot, version }, machine = localMachine()) {
  try {
    const flags = parseFlags(argv, FLAGS)
    return await runDoctor({ root: findRoot(cwd) ?? cwd, translate, pluginRoot, version, write, asJson: Boolean(flags.json) }, machine)
  } catch (error) {
    if (!(error instanceof FlagError)) throw error
    write(`${translate(`cli.${error.code}`, { flag: error.flag })}\n`)
    return 2
  }
}
