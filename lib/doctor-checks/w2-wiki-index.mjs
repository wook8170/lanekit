// W2 — 위키 색인이 있는지, 색인 뒤에 문서가 바뀌었는지 본다. 게이트의 wiki 검사를 그대로 돌려 그 결과를 옮긴다.
// 부르는 곳: index.mjs.
// 먼저 읽을 파일: ../../kit/checks/wiki/run.mjs(판정이 있는 곳), ../../kit/README.md(검사 계약).
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createGit } from '../../kit/lib/git.mjs'
import { createKitTranslator } from '../../kit/lib/messages.mjs'
import { readProjectConfig } from '../project-config.mjs'
import { ok, skip, warn } from './result.mjs'

export const meta = { id: 'W2', title: 'doctor.W2.title' }

const WIKI_CHECK = ['kit', 'checks', 'wiki', 'run.mjs']

export async function check(ctx) {
  const checkFile = join(ctx.plugin.root, ...WIKI_CHECK)
  if (!existsSync(checkFile)) return skip(ctx.t('doctor.W2.no-check'))
  const { config } = readProjectConfig(ctx.root)
  const wikiCheck = await import(pathToFileURL(checkFile).href)
  const result = await wikiCheck.run({
    root: ctx.root,
    config,
    mode: 'warn',
    profile: 'light',
    changedFiles: null,
    git: createGit(ctx.root),
    t: createKitTranslator(config.lang, [dirname(checkFile)]),
  })
  const summary = result.summary ?? ''
  if (result.status === 'skip') return skip(summary)
  if (result.status === 'pass') return ok(summary || ctx.t('doctor.W2.ok'))
  return warn(summary || ctx.t('doctor.W2.stale'), ctx.t('doctor.W2.fix'))
}
