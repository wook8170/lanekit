// S2 — .gitignore 가 .env 파일을 빼는지 본다.
// 부르는 곳: index.mjs.
// 먼저 읽을 파일: 없음(파일 하나를 읽는다).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ok, warn } from './result.mjs'

export const meta = { id: 'S2', title: 'doctor.S2.title' }

const ENV_RULE = /^\/?\.env(\*|\.\*)?$/

export function check(ctx) {
  const file = join(ctx.root, '.gitignore')
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').map((line) => line.trim()) : []
  if (lines.some((line) => ENV_RULE.test(line))) return ok(ctx.t('doctor.S2.ok'))
  return warn(ctx.t('doctor.S2.absent'), ctx.t('doctor.S2.fix'))
}
