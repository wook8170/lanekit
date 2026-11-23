// I3 — 두 지침 파일에 같은 제목의 절이 있는지 본다. 같은 규칙을 두 곳에 두면 한쪽만 고쳐져 어긋난다.
// 부르는 곳: index.mjs.
// 먼저 읽을 파일: ../../kit/checks/guidance/rules.mjs 의 findDuplicateHeadings.
import { findDuplicateHeadings } from '../../kit/checks/guidance/rules.mjs'
import { locate, readGuidanceDocs } from './guidance-docs.mjs'
import { joinShort, ok, warn } from './result.mjs'

export const meta = { id: 'I3', title: 'doctor.I3.title' }

export function check(ctx) {
  const found = findDuplicateHeadings(readGuidanceDocs(ctx.root).docs)
  if (found.length === 0) return ok(ctx.t('doctor.I3.ok'))
  return warn(ctx.t('doctor.I3.found', { lines: joinShort(found.map(locate)) }), ctx.t('doctor.I3.fix'))
}
