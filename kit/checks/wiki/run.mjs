// 위키 연결 검사(wiki) — 색인을 만들거나 검색하지 않는다. 문서 검색이 이어져 있는지와 색인이 낡았는지만 본다.
// 부르는 곳: gate.mjs(등록표의 wiki).
// 먼저 읽을 파일: link.mjs(판정). 색인은 project-wiki 색인기가 만들고, 묶음의 manifest.json 에 만든 커밋이 있다.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { judgeLink, judgeStaleness, sourceGlobs } from './link.mjs'

export const meta = {
  id: 'wiki',
  profiles: ['light', 'changed', 'full'],
  defaultMode: 'warn',
  ratchetable: false,
}

const LANEKEEPER_CONFIG = join('.lanekeeper', 'config.json')
const WIKI_CONFIG_NAME = 'config.json'

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null)
const isDirectory = (path) => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false

/** 색인 메타 파일에서 위로 올라가며 위키 설정(sources 가 있는 config.json)을 찾는다. 루트를 벗어나지 않는다. */
function findWikiConfig(root, indexMeta) {
  let dir = dirname(join(root, indexMeta))
  while (dir.startsWith(root)) {
    const candidate = readJson(join(dir, WIKI_CONFIG_NAME))
    if (Array.isArray(candidate?.sources)) return candidate
    if (dir === root) break
    dir = dirname(dir)
  }
  return null
}

function readState(ctx) {
  const indexMeta = ctx.config.checks.wiki.indexMeta
  const docsSearch = readJson(join(ctx.root, LANEKEEPER_CONFIG))?.docs_search ?? {}
  const indexCommit = readJson(join(ctx.root, indexMeta))?.commit ?? null
  const changed = indexCommit && ctx.git.isRepo() ? ctx.git.listPaths(['diff', '--name-only', indexCommit, 'HEAD']) : null
  return {
    docsSearch,
    indexMeta,
    indexCommit,
    hasDocs: isDirectory(join(ctx.root, 'docs')),
    changedSinceIndex: changed,
    globs: sourceGlobs(findWikiConfig(ctx.root, indexMeta)),
  }
}

/** 검사 계약의 run. git 저장소가 아니면 낡음은 볼 수 없어 연결만 본다. */
export async function run(ctx) {
  const state = readState(ctx)
  const linkRule = judgeLink({ hasDocs: state.hasDocs, searchCommand: state.docsSearch.search })
  if (linkRule === 'not-applicable') return { status: 'skip', summary: ctx.t('wiki.not-applicable'), findings: [], metrics: {}, current: null }
  const staleness = linkRule === null && ctx.git.isRepo() ? judgeStaleness(state) : { rule: null, staleDocs: [] }
  const vars = {
    file: state.indexMeta,
    commit: state.indexCommit,
    count: staleness.staleDocs.length,
    first: staleness.staleDocs[0],
    build: state.docsSearch.build || ctx.t('wiki.build-fallback'),
  }
  const findings = [linkRule, staleness.rule].filter(Boolean).map((rule) => ({
    file: rule === 'search-missing' ? LANEKEEPER_CONFIG : state.indexMeta,
    line: null,
    rule,
    message: ctx.t(`wiki.${rule}`, vars),
    value: 1,
    limit: 0,
  }))
  return {
    status: findings.length > 0 ? 'findings' : 'pass',
    summary: ctx.t('wiki.summary', { count: findings.length, stale: staleness.staleDocs.length }),
    findings,
    metrics: { linked: linkRule === null ? 1 : 0, staleDocs: staleness.staleDocs.length },
    current: null,
  }
}
