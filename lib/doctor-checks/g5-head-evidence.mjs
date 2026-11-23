// G5 — HEAD 커밋에서 게이트를 돌린 증거 파일이 있는지 본다. 증거에 확인하지 못해 건너뛴 검사가 있으면 경고로 알린다. 일부만 돌린 기록(-partial), 커밋하지 않은 변경이 있던 실행, 실패한 실행의 증거는 세지 않는다.
// 부르는 곳: index.mjs.
// 먼저 읽을 파일: ../../kit/lib/evidence.mjs 의 evidencePath · buildEvidence(증거 파일의 이름과 모양).
import { existsSync } from 'node:fs'
import { evidencePath } from '../../kit/lib/evidence.mjs'
import { PROFILES } from '../../kit/lib/profile.mjs'
import { UNVERIFIED_REASON } from '../../kit/lib/verdict.mjs'
import { readJsonOr } from '../json-file.mjs'
import { ok, warn } from './result.mjs'

export const meta = { id: 'G5', title: 'doctor.G5.title' }

/** 순수 판정. 증거로 셀 수 있는가: 작업 트리가 깨끗했고(dirty 가 false) 실패한 검사가 없다. 읽을 수 없는 파일(null)은 세지 않는다. */
export function isUsableEvidence(evidence) {
  return evidence?.dirty === false && Array.isArray(evidence.failed) && evidence.failed.length === 0
}

/** 순수 함수. 증거에서, 도구가 없거나 결과를 얻지 못해 건너뛴 검사의 ID 들. 출하 증거로는 쓰되 경고로 보여 준다. */
export function unverifiedChecks(evidence) {
  return (evidence?.checks ?? []).filter((record) => record.reason === UNVERIFIED_REASON).map((record) => record.id)
}

export function check(ctx) {
  const head = ctx.run('git', ['rev-parse', 'HEAD'])
  if (head.code !== 0) return warn(ctx.t('doctor.G5.no-commit'), ctx.t('doctor.G5.fix'))
  const commit = head.stdout.trim()
  const fileOf = (profile) => evidencePath(ctx.root, { commit, profile, partial: false })
  const present = PROFILES.filter((profile) => existsSync(fileOf(profile)))
  const usable = present.filter((profile) => isUsableEvidence(readJsonOr(fileOf(profile), null)))
  const unverified = [...new Set(usable.flatMap((profile) => unverifiedChecks(readJsonOr(fileOf(profile), null))))]
  if (unverified.length > 0) return warn(ctx.t('doctor.G5.unverified', { profiles: usable.join(', '), checks: unverified.join(', ') }), ctx.t('doctor.G5.fix-unverified'))
  if (usable.length > 0) return ok(ctx.t('doctor.G5.ok', { profiles: usable.join(', ') }))
  if (present.length > 0) return warn(ctx.t('doctor.G5.rejected', { profiles: present.join(', ') }), ctx.t('doctor.G5.fix-rejected'))
  return warn(ctx.t('doctor.G5.absent', { commit: commit.slice(0, 12) }), ctx.t('doctor.G5.fix'))
}
