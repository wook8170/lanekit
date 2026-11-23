// E1 — 공개 저장소인데 금지어 목록이 없는지 본다. 목록이 없으면 노출 검사가 설정 오류로 끝난다.
// 부르는 곳: index.mjs.
// 먼저 읽을 파일: ../../kit/README.md(노출 검사가 목록을 찾는 순서).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DENYLIST_NAME } from '../../kit/checks/exposure/denylist.mjs'
import { userConfigDir } from '../../kit/lib/platform.mjs'
import { readProjectConfig } from '../project-config.mjs'
import { fail, ok } from './result.mjs'

export const meta = { id: 'E1', title: 'doctor.E1.title' }

/** 금지어 목록의 경로. 환경 변수가 먼저고, 없으면 사용자 설정 폴더다. */
export function denylistPath({ home, env, platform }) {
  return env.LANEKIT_DENYLIST || join(userConfigDir({ env, home, platform }), DENYLIST_NAME)
}

export function check(ctx) {
  if (readProjectConfig(ctx.root).config.repo.visibility !== 'public') return ok(ctx.t('doctor.E1.private'))
  if (existsSync(denylistPath(ctx))) return ok(ctx.t('doctor.E1.ok'))
  return fail(ctx.t('doctor.E1.absent'), ctx.t('doctor.E1.fix'))
}
