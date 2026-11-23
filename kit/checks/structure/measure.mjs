// 소스 파일 측정 — 파일 한 개를 TypeScript 컴파일러 API 로 읽어 구조 수치를 잰다. 상한과 견주는 일은 하지 않는다.
// 부르는 곳: run.mjs(대상 파일마다 measureSource 를 부른다).
// 먼저 읽을 파일: typescript.mjs(ts 가 묶이는 곳), readable.mjs(읽기 쉬운 코드 지표), ratchet.mjs(잰 값을 쓰는 곳).
//
// 재는 것: 파일 줄 수 · 함수별(줄 수 · 순환 복잡도 · 중첩 깊이 · 직접 부르는 훅 수) · 빈 catch · console 호출 ·
// 상대 경로 import(값과 타입 구분). 라우트 지표는 routeRules 를 받았을 때만 잰다(ts-fastify 모듈).
// Vue 파일은 <script> 블록만 읽고, <script setup> 은 컴포넌트 함수 하나로 센다.
//
// 함수 키는 「바깥 함수 이름>안쪽 함수 이름」이고, 같은 이름이 또 나오면 `#2` · `#3` 을 붙인다. 줄 번호는 키에 넣지 않는다.
// 이름 없는 콜백에는 부른 곳으로 이름을 붙인다(예: `app.get(/api/x)=>`).
import { hasFileHeader, measureReadable } from './readable.mjs'
import { ts } from './typescript.mjs'

const BRANCH_KIND_NAMES = ['IfStatement', 'ConditionalExpression', 'CaseClause', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoStatement', 'CatchClause']
const LOGICAL_TOKEN_NAMES = ['AmpersandAmpersandToken', 'BarBarToken', 'QuestionQuestionToken', 'AmpersandAmpersandEqualsToken', 'BarBarEqualsToken', 'QuestionQuestionEqualsToken']
const DEPTH_KIND_NAMES = ['IfStatement', 'SwitchStatement', 'TryStatement', 'DoStatement', 'WhileStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'WithStatement']
const MAX_CALLBACK_LABEL = 60

// 구문 종류의 번호는 컴파일러 버전마다 다를 수 있다. 그래서 이름으로 적어 두고, 묶인 컴파일러에서 번호를 찾는다.
let cachedKinds = null
function syntaxKinds() {
  if (cachedKinds?.compiler !== ts) {
    const toKindSet = (names) => new Set(names.map((name) => ts.SyntaxKind[name]))
    cachedKinds = { compiler: ts, branch: toKindSet(BRANCH_KIND_NAMES), logical: toKindSet(LOGICAL_TOKEN_NAMES), depth: toKindSet(DEPTH_KIND_NAMES) }
  }
  return cachedKinds
}

/** 글의 줄 수. 마지막 줄바꿈은 줄로 세지 않는다. */
export function countLines(text) {
  if (!text) return 0
  const lineCount = text.split('\n').length
  return text.endsWith('\n') ? lineCount - 1 : lineCount
}

function scriptKindOf(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (/\.(js|mjs)$/.test(file)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

/** 파일 → 읽을 스크립트 조각의 목록. Vue 는 <script> 블록마다 조각 하나다. */
export function splitScriptChunks(file, text) {
  if (!file.endsWith('.vue')) return [{ text, lineOffset: 0, isSetup: false, kind: scriptKindOf(file) }]
  const chunks = []
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/g
  for (let match = scriptRe.exec(text); match; match = scriptRe.exec(text)) {
    const bodyStart = match.index + match[0].indexOf('>') + 1
    chunks.push({
      text: match[2],
      lineOffset: countLines(text.slice(0, bodyStart)) - 1,
      isSetup: /\bsetup\b/.test(match[1]),
      kind: /lang=["']tsx["']/.test(match[1]) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    })
  }
  return chunks
}

const isFunctionWithBody = (node) => ts.isFunctionLike(node) && !!node.body

function readCalleeText(expression) {
  if (ts.isIdentifier(expression)) return expression.text
  if (expression.kind === ts.SyntaxKind.ThisKeyword) return 'this'
  if (ts.isPropertyAccessExpression(expression)) return `${readCalleeText(expression.expression)}.${expression.name.text}`
  return '…'
}

function nameCallback(call) {
  const firstArg = call.arguments[0]
  const hasLiteralPath = firstArg && (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg))
  const label = hasLiteralPath ? `(${firstArg.text.slice(0, MAX_CALLBACK_LABEL)})` : ''
  return `${readCalleeText(call.expression)}${label}=>`
}

/** 함수 노드 → 이름(바깥 함수 이름은 붙이지 않는다). */
export function readFunctionName(node) {
  if (node.name && 'text' in node.name) return node.name.text
  if (ts.isConstructorDeclaration(node)) return 'constructor'
  const parent = node.parent
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text
  if ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) && parent.name && 'text' in parent.name) return parent.name.text
  if (ts.isCallExpression(parent)) return nameCallback(parent)
  if (ts.isExportAssignment(parent)) return 'default'
  return '<anon>'
}

function isHookCall(node) {
  if (!ts.isCallExpression(node)) return false
  const callee = node.expression
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : ''
  return /^use[A-Z0-9]/.test(name)
}

/** 중첩 깊이를 한 단계 여는 노드인가. else if 는 깊이를 더하지 않는다(ESLint max-depth 와 같은 기준). */
function opensDepth(node) {
  if (!syntaxKinds().depth.has(node.kind)) return false
  return !(ts.isIfStatement(node) && ts.isIfStatement(node.parent) && node.parent.elseStatement === node)
}

function countBranch(node) {
  const kinds = syntaxKinds()
  if (kinds.branch.has(node.kind)) return 1
  return ts.isBinaryExpression(node) && kinds.logical.has(node.operatorToken.kind) ? 1 : 0
}

/** 함수 본문(안쪽 함수 제외) → { complexity, depth, hooks }. */
export function measureBody(body) {
  const metrics = { complexity: 1, depth: 0, hooks: 0 }
  const visit = (node, depth) => {
    if (isFunctionWithBody(node)) return
    metrics.complexity += countBranch(node)
    if (isHookCall(node)) metrics.hooks++
    const innerDepth = depth + (opensDepth(node) ? 1 : 0)
    if (innerDepth > metrics.depth) metrics.depth = innerDepth
    ts.forEachChild(node, (child) => visit(child, innerDepth))
  }
  visit(body, 0)
  return metrics
}

/** `.catch()` 에 넘긴 처리 함수가 아무 일도 하지 않는가: 빈 블록이거나 null · undefined · void 식을 돌려준다. */
function isEmptyHandler(handler) {
  if (!handler || !(ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) return false
  const body = handler.body
  if (ts.isBlock(body)) return body.statements.length === 0
  return body.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(body) && body.text === 'undefined') || ts.isVoidExpression(body)
}

function tallyCall(call, state) {
  const callee = call.expression
  if (!ts.isPropertyAccessExpression(callee)) return
  const owner = ts.isIdentifier(callee.expression) ? callee.expression.text : ''
  if (callee.name.text === 'catch' && isEmptyHandler(call.arguments[0])) state.counts.emptyCatch++
  if (owner === 'console') state.counts.console++
  state.routeRules?.tallyCall(call, state.counts)
}

const isAllTypeOnly = (elements) => !!elements && elements.length > 0 && elements.every((element) => element.isTypeOnly)

function isTypeOnlyImport(clause) {
  if (!clause) return false // `import './x'` 는 실행 순서에 영향이 있다
  const named = clause.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : null
  return clause.isTypeOnly || (!clause.name && isAllTypeOnly(named))
}

/** import · export … from 문 → { spec, typeOnly }. 그런 문이 아니면 null 이다. */
function readImport(node) {
  if (ts.isImportDeclaration(node)) return { spec: node.moduleSpecifier.text, typeOnly: isTypeOnlyImport(node.importClause) }
  if (!ts.isExportDeclaration(node) || !node.moduleSpecifier) return null
  const elements = node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements : null
  return { spec: node.moduleSpecifier.text, typeOnly: node.isTypeOnly || isAllTypeOnly(elements) }
}

/** 함수가 아닌 노드 한 개에서 세는 것. */
function tallyNode(node, state) {
  if (ts.isCatchClause(node) && node.block.statements.length === 0) state.counts.emptyCatch++
  else if (ts.isCallExpression(node)) tallyCall(node, state)
  else {
    const imported = readImport(node)
    if (imported?.spec.startsWith('.')) state.counts.imports.push(imported)
  }
}

/** 함수 종류: component(JSX 파일의 대문자 이름) · route(라우트 정의에 넘긴 처리 함수) · fn. */
function classifyFunction(node, state) {
  const name = readFunctionName(node)
  if (state.isJsx && /^[A-Z]\w*$/.test(name) && !ts.isMethodDeclaration(node)) return 'component'
  return state.routeRules?.isRouteHandler(node, name) ? 'route' : 'fn'
}

function recordFunction(node, name, state) {
  const lineAt = (position) => state.sourceFile.getLineAndCharacterOfPosition(position).line
  const startLine = lineAt(node.getStart(state.sourceFile))
  return {
    name,
    line: startLine + 1 + state.lineOffset,
    lines: lineAt(node.getEnd()) - startLine + 1,
    kind: classifyFunction(node, state),
    ...measureBody(node.body),
  }
}

function walk(node, state) {
  if (isFunctionWithBody(node)) {
    const name = state.prefix + readFunctionName(node)
    state.counts.functions.push(recordFunction(node, name, state))
    ts.forEachChild(node, (child) => walk(child, { ...state, prefix: `${name}>` }))
    return
  }
  tallyNode(node, state)
  const inner = ts.isClassLike(node) && node.name ? { ...state, prefix: `${state.prefix}${node.name.text}.` } : state
  ts.forEachChild(node, (child) => walk(child, inner))
}

/** Vue 의 <template> 블록 줄 수(바깥 <template> 부터 마지막 </template> 까지). */
export function countTemplateLines(text) {
  const start = text.search(/<template[\s>]/)
  const end = text.lastIndexOf('</template>')
  return start >= 0 && end > start ? countLines(text.slice(start, end)) + 1 : 0
}

/** <script setup> 블록 전체를 컴포넌트 함수 하나로 센다. 줄 수에는 템플릿 줄 수를 더한다. */
function recordSetup(sourceFile, chunk, templateLines) {
  const metrics = { complexity: 1, depth: 0, hooks: 0 }
  for (const statement of sourceFile.statements) {
    const measured = measureBody(statement)
    metrics.complexity += measured.complexity - 1
    metrics.hooks += measured.hooks
    metrics.depth = Math.max(metrics.depth, measured.depth)
  }
  const lines = countLines(chunk.text.replace(/^\n/, '')) + templateLines
  return { name: '<script setup>', line: chunk.lineOffset + 1, lines, kind: 'component', ...metrics }
}

/** 같은 이름의 함수에 순번을 붙여 키를 만든다. 첫 번째는 이름 그대로다. */
export function assignKeys(functions) {
  const seen = new Map()
  for (const fn of functions) {
    const order = (seen.get(fn.name) ?? 0) + 1
    seen.set(fn.name, order)
    fn.key = order === 1 ? fn.name : `${fn.name}#${order}`
  }
  return functions
}

/**
 * 파일 한 개를 잰다. file 은 저장소 기준 경로이고, 확장자로 파서 종류를 정한다.
 * readable 은 readable.mjs 의 compileReadableRules 결과다(없으면 읽기 쉬운 코드 지표를 재지 않는다).
 * routeRules 는 라우트 파일일 때만 넘긴다.
 */
export function measureSource(file, text, { readable = null, routeRules = null } = {}) {
  const counts = { lines: countLines(text), functions: [], emptyCatch: 0, console: 0, routes: 0, db: 0, dbIndirect: 0, imports: [], params: 0, shortIds: 0, history: 0, hasHeader: true }
  const chunks = splitScriptChunks(file, text)
  for (const chunk of chunks) {
    const sourceFile = ts.createSourceFile(file, chunk.text, ts.ScriptTarget.Latest, true, chunk.kind)
    const isJsx = chunk.kind === ts.ScriptKind.TSX || chunk.kind === ts.ScriptKind.JSX
    if (chunk.isSetup) counts.functions.push(recordSetup(sourceFile, chunk, countTemplateLines(text)))
    walk(sourceFile, { sourceFile, counts, prefix: '', isJsx, routeRules, lineOffset: chunk.lineOffset })
    if (readable) measureReadable(sourceFile, chunk.text, counts, readable)
  }
  if (readable) counts.hasHeader = hasFileHeader(file, text, chunks)
  assignKeys(counts.functions)
  return counts
}
