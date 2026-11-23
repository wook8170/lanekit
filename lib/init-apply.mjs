// init 의 실행 — init-plan 이 만든 계획대로 파일을 쓴다. 덮어쓸지는 여기서 정하지 않는다.
// 부르는 곳: init.mjs(사용자가 확인한 뒤).
// 먼저 읽을 파일: init-plan.mjs(계획의 모양).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isBlockedPath, writeInside } from '../kit/lib/safe-write.mjs'

/** 계획에 든 경로의 지금 내용을 { 경로: Buffer } 로 읽는다. 없는 파일은 넣지 않는다. */
export function readExisting(root, paths) {
  const present = paths.filter((path) => existsSync(join(root, path)))
  return Object.fromEntries(present.map((path) => [path, readFileSync(join(root, path))]))
}

/** 계획에서 쓸 수 없는 항목을 blocked 로 바꾼다. 쓰지 않고 사용자에게 알린다. */
export function markBlocked(root, plan) {
  return plan.map((entry) => (entry.action !== 'keep' && isBlockedPath(root, entry.writePath) ? { ...entry, action: 'blocked' } : entry))
}

/** keep · blocked 가 아닌 항목을 writePath 에 쓴다. 쓴 항목을 돌려준다. */
export function applyPlan(root, plan) {
  const writable = plan.filter((entry) => entry.action !== 'keep' && entry.action !== 'blocked')
  for (const entry of writable) writeInside(root, entry.writePath, entry.content, { executable: entry.executable && entry.action === 'write' })
  return writable
}

/** 순수 함수. .gitignore 계획에 쓸 경로(writePath)를 붙인다. suggest 는 제안 폴더에 고친 내용을 통째로 둔다. */
export function withGitignoreTarget(gitignorePlan, suggestionsDir) {
  return { ...gitignorePlan, writePath: gitignorePlan.action === 'suggest' ? `${suggestionsDir}/.gitignore` : '.gitignore' }
}

/** .gitignore 계획을 쓴다. keep · blocked 면 쓰지 않는다. */
export function applyGitignore(root, gitignorePlan) {
  if (gitignorePlan.action === 'keep' || gitignorePlan.action === 'blocked') return
  writeInside(root, gitignorePlan.writePath, gitignorePlan.content)
}
