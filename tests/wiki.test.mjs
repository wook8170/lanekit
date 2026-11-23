// 위키 연결 검사 테스트 — 문서 검색이 이어졌는지, 색인을 만든 커밋 뒤에 문서가 바뀌었는지를 본다.
// 대상: kit/checks/wiki/run.mjs · link.mjs.
// 먼저 읽을 파일: ../kit/checks/wiki/link.mjs(판정).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { judgeLink, judgeStaleness, sourceGlobs } from '../kit/checks/wiki/link.mjs'
import { run } from '../kit/checks/wiki/run.mjs'
import { validateConfig } from '../kit/lib/config.mjs'
import { callCheck, rulesOf } from './check-helpers.mjs'
import { commitAll, git, makeProject, writeFiles } from './helpers.mjs'

const INDEX_META = '.wiki/index/bundle/manifest.json'
const LANEKEEPER = { version: 1, docs_search: { search: 'wiki search "{query}"', build: 'wiki build' } }
const WIKI_CONFIG = { schema: 1, sources: [{ adapter: 'markdown', include: ['docs/**/*.md'] }, { adapter: 'markdown', include: ['*.md'] }] }

/** 문서와 위키 설정이 있는 저장소를 만들고, 색인을 지금 커밋에서 만든 것으로 적는다. */
function linkedProject() {
  const dir = makeProject({}, {
    '.gitignore': '.lanekit/\n.wiki/index/\n',
    'docs/guide.md': '# guide\n',
    'src/a.mjs': 'export const a = 1\n',
    '.lanekeeper/config.json': LANEKEEPER,
    '.wiki/config.json': WIKI_CONFIG,
  })
  const commit = commitAll(dir)
  writeFiles(dir, { [INDEX_META]: { formatVersion: 1, commit: commit.slice(0, 10), dirty: false } })
  return dir
}

function commitChange(dir, files) {
  writeFiles(dir, files)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'change')
}

test('색인 메타의 기본 위치는 project-wiki 묶음의 manifest.json 이다', () => {
  assert.equal(validateConfig({}).config.checks.wiki.indexMeta, INDEX_META)
})

test('검색이 이어져 있고 색인 뒤에 문서가 바뀌지 않았으면 통과한다', async () => {
  const dir = linkedProject()
  commitChange(dir, { 'src/a.mjs': 'export const a = 2\n' })
  const result = await callCheck(run, 'wiki', dir)
  assert.equal(result.status, 'pass', JSON.stringify(result.findings))
  assert.deepEqual(result.metrics, { linked: 1, staleDocs: 0 })
})

test('색인을 만든 커밋 뒤에 문서가 바뀌면 낡았다고 알리고 build 명령을 알려 준다', async () => {
  const dir = linkedProject()
  commitChange(dir, { 'docs/guide.md': '# guide\n\nmore\n', 'README.md': '# acme\n', 'notes/skip.md': 'x\n' })
  const result = await callCheck(run, 'wiki', dir)
  assert.deepEqual(rulesOf(result), ['index-stale'])
  assert.equal(result.metrics.staleDocs, 2, '위키 설정의 글롭에 든 문서만 센다')
  assert.match(result.findings[0].message, /문서 2개가 바뀌었다\(예: README\.md\)\. 다시 만든다: wiki build$/)
  assert.equal(result.findings[0].file, INDEX_META)
})

test('문서 폴더가 있는데 검색 명령이 비어 있으면 찾은 것으로 낸다', async () => {
  const noConfig = makeProject({}, { 'docs/guide.md': '# guide\n' })
  assert.deepEqual(rulesOf(await callCheck(run, 'wiki', noConfig)), ['search-missing'])
  const emptySearch = makeProject({}, { 'docs/guide.md': '# guide\n', '.lanekeeper/config.json': { version: 1, docs_search: { search: '' } } })
  const result = await callCheck(run, 'wiki', emptySearch)
  assert.deepEqual(result.findings.map((found) => [found.file, found.rule]), [['.lanekeeper/config.json', 'search-missing']])
})

test('문서 폴더도 검색 설정도 없으면 건너뛴다', async () => {
  assert.equal((await callCheck(run, 'wiki', makeProject({}, { 'src/a.mjs': '' }))).status, 'skip')
})

test('색인이 없거나 색인을 만든 커밋을 모르면 찾은 것으로 낸다', async () => {
  const noIndex = makeProject({}, { 'docs/guide.md': '# guide\n', '.lanekeeper/config.json': LANEKEEPER })
  commitAll(noIndex)
  const missing = await callCheck(run, 'wiki', noIndex)
  assert.deepEqual(rulesOf(missing), ['index-missing'])
  assert.match(missing.findings[0].message, /색인을 만든다: wiki build$/)
  const unknown = linkedProject()
  writeFiles(unknown, { [INDEX_META]: { commit: '0123456789' } })
  assert.deepEqual(rulesOf(await callCheck(run, 'wiki', unknown)), ['index-commit-unknown'])
})

test('indexMeta 설정으로 색인 메타의 위치를 바꿀 수 있다', async () => {
  const dir = makeProject({ checks: { wiki: { indexMeta: 'build/wiki-meta.json' } } }, { 'docs/guide.md': '# guide\n', '.lanekeeper/config.json': LANEKEEPER })
  const commit = commitAll(dir)
  writeFiles(dir, { 'build/wiki-meta.json': { commit } })
  assert.equal((await callCheck(run, 'wiki', dir)).status, 'pass')
  commitChange(dir, { 'notes/any.md': 'x\n' })
  assert.deepEqual(rulesOf(await callCheck(run, 'wiki', dir)), ['index-stale'], '위키 설정이 없으면 모든 마크다운을 본다')
})

test('판정 함수', () => {
  assert.equal(judgeLink({ hasDocs: true, searchCommand: 'x' }), null)
  assert.equal(judgeLink({ hasDocs: false, searchCommand: undefined }), 'not-applicable')
  assert.deepEqual(sourceGlobs(null), ['**/*.md'])
  assert.deepEqual(sourceGlobs(WIKI_CONFIG), ['docs/**/*.md', '*.md'])
  assert.deepEqual(judgeStaleness({ indexCommit: 'abc', changedSinceIndex: ['src/a.mjs'], globs: ['docs/**'] }), { rule: null, staleDocs: [] })
  assert.equal(judgeStaleness({ indexCommit: null, changedSinceIndex: null, globs: [] }).rule, 'index-missing')
})
