// I1 — 지침 파일이 예산(CLAUDE.md 의 줄 수, AGENTS.md 의 바이트)을 넘는지 본다. 규칙은 게이트의 guidance 검사와 같은 함수다.
// 부르는 곳: index.mjs.
// 먼저 읽을 파일: ../../kit/checks/guidance/rules.mjs 의 findOversize.
import { findOversize } from '../../kit/checks/guidance/rules.mjs'
import { readGuidanceDocs } from './guidance-docs.mjs'
import { ok, warn } from './result.mjs'

export const meta = { id: 'I1', title: 'doctor.I1.title' }

export function check(ctx) {
  const { docs, settings } = readGuidanceDocs(ctx.root)
  const oversize = docs.flatMap((doc) => findOversize(doc, settings))
  if (oversize.length === 0) return ok(ctx.t('doctor.I1.ok'))
  const list = oversize.map((finding) => `${finding.file} ${finding.value} > ${finding.limit}`).join(', ')
  return warn(ctx.t('doctor.I1.oversize', { list }), ctx.t('doctor.I1.fix'))
}
