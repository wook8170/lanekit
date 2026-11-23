// I4 — 이 저장소의 메모리 색인(MEMORY.md)이 150줄 또는 20 KB 를 넘는지 본다. 색인을 찾지 못하면 건너뛴다.
// 부르는 곳: index.mjs.
// 먼저 읽을 파일: ../claude-home.mjs 의 memoryIndexPath.
import { existsSync, readFileSync } from 'node:fs'
import { memoryIndexPath } from '../claude-home.mjs'
import { ok, skip, warn } from './result.mjs'

export const MEMORY_LIMITS = { lines: 150, bytes: 20000 }
export const meta = { id: 'I4', title: 'doctor.I4.title' }

export function check(ctx) {
  const file = memoryIndexPath(ctx, ctx.root)
  if (!existsSync(file)) return skip(ctx.t('doctor.I4.not-found'))
  const content = readFileSync(file)
  const measured = { lines: content.toString('utf8').replace(/\n$/, '').split('\n').length, bytes: content.length }
  const isOver = measured.lines > MEMORY_LIMITS.lines || measured.bytes > MEMORY_LIMITS.bytes
  if (!isOver) return ok(ctx.t('doctor.I4.ok', measured))
  return warn(ctx.t('doctor.I4.over', measured), ctx.t('doctor.I4.fix'))
}
