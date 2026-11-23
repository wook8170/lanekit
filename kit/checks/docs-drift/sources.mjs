// 문서 드리프트의 원천 — 설정의 source 를 읽어 「코드에서 센 값」을 구한다. kind 마다 함수가 하나다.
// 부르는 곳: run.mjs(사실 하나마다 한 번).
// 먼저 읽을 파일: run.mjs(구한 값을 문서의 값과 견주는 곳).
import { runShell } from '../../lib/exec.mjs'
import { listWorkFiles, readTextFile } from '../../lib/files.mjs'
import { filterByGlobs } from '../../lib/glob.mjs'

// 돌려주는 값은 { value } · { problem, detail } · { deferred: true } 가운데 하나다.
// value 는 문서의 값과 글자로 견주므로 문자열이다.
const valueOf = (raw) => ({ value: String(raw) })
const problemOf = (problem, detail = '') => ({ problem, detail })

function requireFields(source, fields) {
  const missing = fields.filter((field) => !source[field])
  return missing.length > 0 ? problemOf('source-field-missing', missing.join(', ')) : null
}

function countFiles(source, project) {
  return requireFields(source, ['glob']) ?? valueOf(filterByGlobs(project.files(), [source.glob]).length)
}

function countMatches(source, project) {
  const missing = requireFields(source, ['glob', 'pattern'])
  if (missing) return missing
  const pattern = new RegExp(source.pattern, 'gm')
  const texts = filterByGlobs(project.files(), [source.glob]).map((file) => project.read(file) ?? '')
  return valueOf(texts.reduce((total, text) => total + [...text.matchAll(pattern)].length, 0))
}

/** JSON 안의 `a.b.c` 경로를 따라간다. 없으면 undefined 다. */
export function readJsonPath(document, path) {
  const keys = path === '' ? [] : path.split('.')
  return keys.reduce((node, key) => (node === null || node === undefined ? undefined : node[key]), document)
}

function readJsonNode(source, project) {
  const missing = requireFields(source, ['file'])
  if (missing) return missing
  const text = project.read(source.file)
  if (text === null) return problemOf('source-file-missing', source.file)
  const node = readJsonPath(JSON.parse(text), source.path)
  return node === undefined ? problemOf('source-path-missing', `${source.file} · ${source.path}`) : { node }
}

function jsonLength(source, project) {
  const found = readJsonNode(source, project)
  if (!('node' in found)) return found
  if (Array.isArray(found.node)) return valueOf(found.node.length)
  if (found.node !== null && typeof found.node === 'object') return valueOf(Object.keys(found.node).length)
  return problemOf('source-not-countable', `${source.file} · ${source.path}`)
}

function jsonValue(source, project) {
  const found = readJsonNode(source, project)
  return 'node' in found ? valueOf(found.node) : found
}

// 명령은 프로젝트의 코드를 실행한다. 그래서 출하 전(full)에만 돌리고, 그 밖의 프로필에서는 미룬다.
function commandOutput(source, project) {
  const missing = requireFields(source, ['command'])
  if (missing) return missing
  if (project.profile !== 'full') return { deferred: true }
  const outcome = runShell(source.command, { cwd: project.root })
  if (outcome.code !== 0) return problemOf('source-command-failed', `${source.command} · ${outcome.code ?? outcome.startError}`)
  return valueOf(outcome.stdout.split('\n')[0].trim())
}

const MEASURES = {
  'count-files': countFiles,
  'count-matches': countMatches,
  'json-length': jsonLength,
  'json-value': jsonValue,
  command: commandOutput,
}

/** 검사가 원천을 읽을 때 쓰는 프로젝트 창구. 파일 목록은 처음 쓸 때 한 번만 만든다. */
export function openProject({ root, git, profile }) {
  let cachedFiles = null
  return {
    root,
    profile,
    files: () => (cachedFiles ??= listWorkFiles(root, git)),
    read: (file) => readTextFile(root, file),
  }
}

/** source 하나를 잰다. 읽다가 난 오류(틀린 정규식 · 깨진 JSON)는 문제로 바꿔 돌려준다. */
export function measureSource(source, project) {
  try {
    return MEASURES[source.kind](source, project)
  } catch (error) {
    return problemOf('source-unreadable', error.message)
  }
}
