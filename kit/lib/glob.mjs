// 글롭 맞추기 — `**` · `*` · `?` · `{a,b}` 를 쓰는 글롭을 정규식으로 바꿔 경로와 견준다. 경로 구분자는 `/` 다.
// 부르는 곳: lib/files.mjs 를 쓰는 검사(글롭으로 파일 고르기), 검사의 허용 목록(파일 글롭), structure 검사(잴 소스 고르기).
// 먼저 읽을 파일: ../checks/writing/run.mjs(쓰는 예).

const ESCAPED = /[.+^$()|[\]\\]/g

// 글롭 조각 → 정규식 조각. 앞에 있는 것이 먼저 맞는다.
const TOKENS = [
  { glob: '**/', pattern: '(?:[^/]+/)*' },
  { glob: '**', pattern: '.*' },
  { glob: '*', pattern: '[^/]*' },
  { glob: '?', pattern: '[^/]' },
]

function translateBrace(char, depth) {
  if (char === '{') return { pattern: '(?:', depth: depth + 1 }
  if (char === '}' && depth > 0) return { pattern: ')', depth: depth - 1 }
  if (char === ',' && depth > 0) return { pattern: '|', depth }
  return { pattern: char.replace(ESCAPED, '\\$&'), depth }
}

/** 글롭 하나를 경로 전체와 견주는 정규식으로 바꾼다. 쉼표는 중괄호 안에서만 「또는」이다. */
export function globToRegExp(glob) {
  let pattern = ''
  let depth = 0
  let index = 0
  while (index < glob.length) {
    const token = TOKENS.find((candidate) => glob.startsWith(candidate.glob, index))
    if (token) {
      pattern += token.pattern
      index += token.glob.length
    } else {
      const translated = translateBrace(glob[index], depth)
      pattern += translated.pattern
      depth = translated.depth
      index += 1
    }
  }
  return new RegExp(`^${pattern}$`)
}

/** 글롭 목록 가운데 하나라도 맞는가를 답하는 함수를 만든다. 빈 글롭은 버린다. 목록이 비면 아무것도 맞지 않는다. */
export function createMatcher(globs) {
  const patterns = globs.filter(Boolean).map(globToRegExp)
  return (path) => patterns.some((pattern) => pattern.test(path))
}

/** 경로가 글롭 가운데 하나에라도 맞는가. */
export function matchesAny(path, globs) {
  return globs.some((glob) => globToRegExp(glob).test(path))
}

/** 경로 목록에서 글롭에 맞는 것만 고른다. */
export function filterByGlobs(paths, globs) {
  const patterns = globs.map(globToRegExp)
  return paths.filter((path) => patterns.some((pattern) => pattern.test(path)))
}
