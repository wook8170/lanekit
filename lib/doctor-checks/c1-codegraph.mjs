// C1 — codegraph 색인이 있는지 본다. 판정은 레인키퍼가 하므로 그 doctor 의 해당 줄을 그대로 옮긴다.
// 부르는 곳: index.mjs.
// 먼저 읽을 파일: ../process.mjs(명령이 없을 때의 코드).
import { COMMAND_NOT_FOUND } from '../process.mjs'
import { ok, skip, warn } from './result.mjs'

export const meta = { id: 'C1', title: 'doctor.C1.title' }

const OK_MARK = '✓'

export function check(ctx) {
  const doctor = ctx.run('lanekeeper-config', ['doctor'])
  if (doctor.code === COMMAND_NOT_FOUND) return skip(ctx.t('doctor.C1.no-lanekeeper'))
  const lines = doctor.stdout.split('\n').filter((line) => /codegraph/i.test(line)).map((line) => line.trim())
  if (lines.length === 0) return skip(ctx.t('doctor.C1.no-line'))
  const troubled = lines.filter((line) => !line.startsWith(OK_MARK))
  return troubled.length === 0 ? ok(lines[0]) : warn(troubled.join(' / '), ctx.t('doctor.C1.fix'))
}
