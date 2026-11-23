// G3 — git 이 .githooks 를 훅 폴더로 쓰고, pre-push 훅이 실행 가능한지 본다.
// 부르는 곳: index.mjs.
// 먼저 읽을 파일: ../template-map.mjs 의 HOOK_TARGET.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createGit } from '../../kit/lib/git.mjs'
import { hasModeBits, toPosixPath } from '../../kit/lib/platform.mjs'
import { readProjectConfig } from '../project-config.mjs'
import { HOOK_TARGET } from '../template-map.mjs'
import { ok, warn } from './result.mjs'

export const meta = { id: 'G3', title: 'doctor.G3.title' }

const EXECUTE_BITS = 0o111
const NOT_EXECUTABLE_IN_INDEX = '100644 '

/**
 * 순수 판정. 훅의 상태를 고른다: ok · missing · crlf · not-executable · index-not-executable.
 * hook 은 { content(없으면 null), mode, indexEntry } 다. indexEntry 는 `git ls-files --stage` 의 그 파일 줄이다.
 * 실행 비트가 없는 플랫폼(Windows)에서는 git 이 비트 없이도 훅을 돌린다. 다만 인덱스에 644 로 올라가면 다른 플랫폼의 복제본에서 훅이 돌지 않는다.
 */
export function judgeHook(hook, platform) {
  if (hook.content === null) return 'missing'
  if (hook.content.includes('\r')) return 'crlf'
  if (!hasModeBits(platform)) return hook.indexEntry.startsWith(NOT_EXECUTABLE_IN_INDEX) ? 'index-not-executable' : 'ok'
  return (hook.mode & EXECUTE_BITS) === 0 ? 'not-executable' : 'ok'
}

const FIXES = { missing: 'fix-chmod', 'not-executable': 'fix-chmod', crlf: 'fix-crlf', 'index-not-executable': 'fix-index' }
const PROBLEMS = { missing: 'not-executable', 'not-executable': 'not-executable', crlf: 'crlf', 'index-not-executable': 'index-not-executable' }

function readHook(ctx) {
  const file = join(ctx.root, HOOK_TARGET)
  if (!existsSync(file)) return { content: null, mode: 0, indexEntry: '' }
  const staged = createGit(ctx.root).listPaths(['ls-files', '--stage', '--', HOOK_TARGET]) ?? []
  return { content: readFileSync(file, 'utf8'), mode: statSync(file).mode, indexEntry: staged[0] ?? '' }
}

export function check(ctx) {
  if (readProjectConfig(ctx.root).config.remote_gate === 'none') return ok(ctx.t('doctor.G3.not-used'))
  const hooksDir = dirname(HOOK_TARGET)
  const configured = ctx.run('git', ['config', '--get', 'core.hooksPath'])
  const configuredDir = toPosixPath(configured.stdout.trim(), ctx.platform).replace(/\/$/, '')
  const isConfigured = configured.code === 0 && configuredDir === hooksDir
  if (!isConfigured) return warn(ctx.t('doctor.G3.not-configured', { dir: hooksDir }), ctx.t('doctor.G3.fix-config', { dir: hooksDir }))
  const state = judgeHook(readHook(ctx), ctx.platform)
  if (state === 'ok') return ok(ctx.t('doctor.G3.ok'))
  return warn(ctx.t(`doctor.G3.${PROBLEMS[state]}`, { file: HOOK_TARGET }), ctx.t(`doctor.G3.${FIXES[state]}`, { file: HOOK_TARGET }))
}
