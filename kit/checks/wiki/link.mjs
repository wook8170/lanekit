// 위키 연결의 판정 — 문서 검색이 이어져 있는지, 색인이 문서보다 낡았는지를 정한다. 모두 순수 함수다.
// 부르는 곳: run.mjs.
// 먼저 읽을 파일: run.mjs(설정과 색인 메타를 읽어 이 함수들에 넘기는 곳).
import { filterByGlobs } from '../../lib/glob.mjs'

const ANY_MARKDOWN = ['**/*.md']

/** 위키 설정(sources[].include)에서 문서 글롭을 모은다. 설정이 없거나 비어 있으면 모든 마크다운을 본다. */
export function sourceGlobs(wikiConfig) {
  const includes = (wikiConfig?.sources ?? []).flatMap((source) => source.include ?? [])
  return includes.length > 0 ? includes : ANY_MARKDOWN
}

/**
 * 연결 판정. 돌려주는 값은 규칙 이름이나 null(문제 없음) · 'not-applicable'(볼 것이 없음)이다.
 * 문서 폴더가 있는데 검색 명령이 비어 있으면 에이전트가 문서를 파일로 훑게 된다.
 */
export function judgeLink({ hasDocs, searchCommand }) {
  if (searchCommand) return null
  return hasDocs ? 'search-missing' : 'not-applicable'
}

/**
 * 낡음 판정. indexCommit 은 색인을 만든 커밋, changedSinceIndex 는 그 커밋 뒤에 바뀐 파일이다(git 이 그 커밋을 모르면 null).
 * 돌려주는 값은 { rule, staleDocs } 다. rule 이 null 이면 색인이 문서와 맞는다.
 */
export function judgeStaleness({ indexCommit, changedSinceIndex, globs }) {
  if (!indexCommit) return { rule: 'index-missing', staleDocs: [] }
  if (changedSinceIndex === null) return { rule: 'index-commit-unknown', staleDocs: [] }
  const staleDocs = filterByGlobs(changedSinceIndex, globs)
  return { rule: staleDocs.length > 0 ? 'index-stale' : null, staleDocs }
}
