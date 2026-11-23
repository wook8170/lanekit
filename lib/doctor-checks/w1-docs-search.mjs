// W1 — 문서 폴더가 있는 저장소에서 레인키퍼의 문서 검색 명령(docs_search.search)이 채워져 있는지 본다.
// 부르는 곳: index.mjs.
// 먼저 읽을 파일: ../lanekeeper-link.mjs 의 readLanekeeperConfig.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readLanekeeperConfig } from '../lanekeeper-link.mjs'
import { ok, warn } from './result.mjs'

export const DOCS_DIRS = ['docs', 'doc', 'documentation']
export const meta = { id: 'W1', title: 'doctor.W1.title' }

export function check(ctx) {
  const docsDir = DOCS_DIRS.find((name) => existsSync(join(ctx.root, name)))
  if (!docsDir) return ok(ctx.t('doctor.W1.no-docs'))
  if (readLanekeeperConfig(ctx.root)?.docs_search?.search) return ok(ctx.t('doctor.W1.ok'))
  return warn(ctx.t('doctor.W1.empty', { dir: docsDir }), ctx.t('doctor.W1.fix'))
}
