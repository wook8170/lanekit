// K1 — lanekit.config.json 이 있고 스키마에 맞는지 본다.
// 부르는 곳: index.mjs.
// 먼저 읽을 파일: ../project-config.mjs.
import { readProjectConfig } from '../project-config.mjs'
import { fail, ok } from './result.mjs'

export const meta = { id: 'K1', title: 'doctor.K1.title' }

const describeProblem = (problem) => [problem.path, problem.code, problem.expected].filter(Boolean).join(' · ')

export function check(ctx) {
  const project = readProjectConfig(ctx.root)
  if (!project.found) return fail(ctx.t('doctor.K1.absent'), ctx.t('doctor.K1.fix-init'))
  if (!project.parsed) return fail(ctx.t('doctor.K1.not-json'), ctx.t('doctor.K1.fix'))
  if (project.problems.length === 0) return ok(ctx.t('doctor.K1.ok'))
  return fail(ctx.t('doctor.K1.invalid', { problems: project.problems.map(describeProblem).join(' / ') }), ctx.t('doctor.K1.fix'))
}
