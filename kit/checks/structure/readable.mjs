// 읽기 쉬운 코드 지표 — 자동으로 잴 수 있는 네 가지(입력 칸 초과 · 짧은 이름 · 이력 주석 · 머리 주석)를 잰다.
// 부르는 곳: measure.mjs 의 measureSource(파일 한 개를 잴 때 함께 부른다). 상한 판정은 ratchet.mjs 가 한다.
// 먼저 읽을 파일: ../../lib/schema.mjs 의 structure.readable(설정 칸과 기본값).
//
// 재는 것
//   params    — 매개변수가 상한을 넘는 함수, 또는 구조 분해 · 타입의 칸이 상한을 넘는 입력 객체를 받는 함수의 수.
//               화면 컴포넌트(React 함수 컴포넌트의 props · Vue defineProps)는 props 상한을 쓴다.
//   shortIds  — 한 글자 이름과 금지 약어로 선언한 이름의 수(예외는 isAllowedShort)
//   history   — 주석 안에 이력 표식(버전 · PR · 티켓 번호)이 든 줄의 수
//   hasHeader — 파일 맨 앞(Vue 는 맨 앞이나 <script> 블록 맨 앞)에 머리 주석이 있는가
import { ts } from './typescript.mjs'
import { splitLines } from '../../lib/platform.mjs'

// 이 줄 수 이하인 화살표 함수의 매개변수는 이름이 짧아도 세지 않는다.
const SHORT_ARROW_LINES = 3
// 어디서나 허용하는 짧은 이름(자리 표시 · 좌표)
const ALWAYS_ALLOWED = new Set(['_', 'x', 'y'])
// 반복문 변수나 매개변수일 때만 허용하는 이름
const INDEX_NAMES = new Set(['i', 'j', 'k'])
// 뒤에 숫자를 붙여 쓰면 뜻이 없어지는 이름. 금지 약어에 숫자를 붙인 것도 같이 센다.
const NUMBERED_STEMS = new Set(['res', 'arr', 'str', 'buf', 'data', 'result', 'ret'])
// 입력 객체로 보는 타입 이름. 같은 파일에 선언한 이 이름의 타입은 칸 수를 센다. 엔터티 타입은 칸이 많아도 세지 않는다.
const INPUT_TYPE_NAME_RE = /(Opts|Options|Input|Inputs|Props|Params|Args|Deps|Ctx|Context)$/

// 표준 · 규격 이름은 티켓 번호와 모양이 같아서 뺀다(문자 인코딩 · 해시 · 국제 표준 번호).
const STANDARD_PREFIXES =
  'UTF|SHA|ISO|AES|RSA|ES|HS|RS|PS|ECMA|IEC|IEEE|ANSI|RFC|TLS|SSL|HTTP|MD|CP|EUC|ARGB|RGB|CVE|CWE|GHSA|SQL|UTC|GMT|GB|WCAG|P|X|U'
// 어느 프로젝트에나 통하는 이력 표식. 프로젝트 고유의 표식은 설정 readable.historyPatterns 로 더한다.
const GENERIC_HISTORY_RES = [
  /(?<![\w.])v\d+\.\d+(\.\d+)?\b/, // v 를 앞에 붙인 버전
  /(?<![\w.])\d{1,3}\.\d+\.\d+(?![\w.])/, // 세 마디 버전. 날짜와 네 마디 주소 모양은 뺀다
  /(?<![\w.])\d+\.\d+(?=\s*[—–]|\s+(에서|부터|이후|이전|버전|출하|릴리스|since|release)(?![가-힣\w]))/, // 두 마디 버전 뒤에 줄표나 시점을 말하는 낱말이 올 때
  new RegExp(`\\b(?!(${STANDARD_PREFIXES})-)[A-Z]{1,5}-\\d{1,5}\\b`), // 대문자 · 붙임표 · 숫자로 된 티켓 번호
  /(PR|MR|이슈|issue|pull request)\s*#\d+|\(#\d{2,}\)/i, // PR · 이슈 번호
]

/** 정규식 문자열 목록을 정규식으로 바꾼다. 문법이 틀린 것은 broken 에 모은다. */
function compilePatterns(sources) {
  const patterns = []
  const broken = []
  for (const source of sources) {
    try {
      patterns.push(new RegExp(source))
    } catch (error) {
      broken.push(`${source} (${error.message})`)
    }
  }
  return { patterns, broken }
}

/** 설정 readable 칸 → 측정에 쓰는 규칙. broken 은 문법이 틀린 정규식의 목록이다. */
export function compileReadableRules(readable) {
  const history = compilePatterns(readable.historyPatterns)
  const exempt = compilePatterns(readable.historyExempt)
  return {
    maxParams: readable.maxParams,
    maxProps: readable.maxProps,
    bannedNames: new Set(readable.bannedNames),
    historyRes: [...GENERIC_HISTORY_RES, ...history.patterns],
    historyExemptRes: exempt.patterns,
    broken: [...history.broken, ...exempt.broken],
  }
}

// ── 매개변수 ─────────────────────────────────────────────

/** 꼭 넘겨야 하는 칸 수. 선택 칸(`a?:`)만 많은 설정 묶음은 경계가 잘못된 것으로 보지 않는다. */
const countRequired = (members) => members.filter((member) => !member.questionToken).length

/** 같은 파일에 선언한 interface · type { … } 의 칸 수 { required, all }. 확장해서 받은 칸은 세지 않는다. */
function readLocalTypeSizes(sourceFile) {
  const sizes = new Map()
  const record = (name, members) => sizes.set(name, { required: countRequired(members), all: members.length })
  for (const statement of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(statement)) record(statement.name.text, statement.members)
    else if (ts.isTypeAliasDeclaration(statement) && ts.isTypeLiteralNode(statement.type)) record(statement.name.text, statement.type.members)
  }
  return sizes
}

/**
 * 매개변수 하나가 입력 객체라면 그 칸 수. 구조 분해 칸과 타입 칸 가운데 큰 값이다.
 * 타입은 그 자리의 { … } 이거나 같은 파일에 선언한 입력 객체 이름일 때만 필수 칸을 센다.
 * 구조 분해는 실제로 꺼내 쓰는 칸이라 선택 칸도 센다.
 */
function countParamFields(param, typeSizes) {
  const fromBinding = ts.isObjectBindingPattern(param.name) ? param.name.elements.length : 0
  const typeNode = param.type
  let fromType = 0
  if (typeNode && ts.isTypeLiteralNode(typeNode)) fromType = countRequired(typeNode.members)
  else if (typeNode && ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName) && INPUT_TYPE_NAME_RE.test(typeNode.typeName.text)) {
    fromType = typeSizes.get(typeNode.typeName.text)?.required ?? 0
  }
  return Math.max(fromBinding, fromType)
}

/** React 함수 컴포넌트인가. JSX 파일에서 대문자로 시작하는 이름의 함수다(메서드 제외). measure.mjs 의 컴포넌트 판정과 같다. */
function isComponent(fn, sourceFile) {
  if (sourceFile.languageVariant !== ts.LanguageVariant.JSX || ts.isMethodDeclaration(fn)) return false
  const parent = fn.parent
  const name = fn.name?.text ?? (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) ? parent.name.text : '')
  return /^[A-Z]\w*$/.test(name)
}

/** 매개변수 수나 입력 객체의 칸 수가 상한을 넘는가. 상한은 일반 함수 maxParams, 화면 컴포넌트의 props 는 maxProps 다. */
export function isParamsOverLimit(fn, typeSizes, { sourceFile, rules }) {
  const params = fn.parameters.filter((param) => !(ts.isIdentifier(param.name) && param.name.text === 'this'))
  if (params.length > rules.maxParams) return true
  const fieldLimit = isComponent(fn, sourceFile) ? rules.maxProps : rules.maxParams
  return params.some((param) => countParamFields(param, typeSizes) > fieldLimit)
}

/** Vue `defineProps<{ … }>()` · `defineProps<Props>()` · `defineProps({ … })` · `defineProps([…])` 의 props 수. 아니면 -1 이다. */
function countDefineProps(node, typeSizes) {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'defineProps') return -1
  const typeArg = node.typeArguments?.[0]
  if (typeArg && ts.isTypeLiteralNode(typeArg)) return typeArg.members.length
  if (typeArg && ts.isTypeReferenceNode(typeArg) && ts.isIdentifier(typeArg.typeName)) return typeSizes.get(typeArg.typeName.text)?.all ?? 0
  const firstArg = node.arguments[0]
  if (firstArg && ts.isObjectLiteralExpression(firstArg)) return firstArg.properties.length
  if (firstArg && ts.isArrayLiteralExpression(firstArg)) return firstArg.elements.length
  return 0
}

// ── 짧은 이름 ────────────────────────────────────────────

function countNodeLines(sourceFile, node) {
  const lineAt = (position) => sourceFile.getLineAndCharacterOfPosition(position).line
  return lineAt(node.getEnd()) - lineAt(node.getStart(sourceFile)) + 1
}

/** 선언이 속한 매개변수. 구조 분해 안쪽 이름이면 바깥 매개변수까지 올라간다. 매개변수가 아니면 null 이다. */
function findOwningParam(node) {
  let current = node
  while (current && (ts.isBindingElement(current) || ts.isObjectBindingPattern(current) || ts.isArrayBindingPattern(current))) current = current.parent
  return current && ts.isParameter(current) ? current : null
}

function isLoopVariable(declaration) {
  const list = declaration.parent
  const loop = list?.parent
  return !!loop && ts.isVariableDeclarationList(list) && (ts.isForStatement(loop) || ts.isForOfStatement(loop) || ts.isForInStatement(loop))
}

/** 짧은 이름이라도 세지 않는 경우: 좌표 · 자리 표시, 반복문의 i · j · k, 이벤트 · 오류의 e, 짧은 화살표 함수의 인자. */
function isAllowedShort(name, node, sourceFile) {
  if (ALWAYS_ALLOWED.has(name)) return true
  const param = findOwningParam(node)
  if (INDEX_NAMES.has(name) && (param || (ts.isVariableDeclaration(node) && isLoopVariable(node)))) return true
  if (name === 'e' && (param || ts.isCatchClause(node.parent))) return true
  const fn = param?.parent
  return !!fn && ts.isArrowFunction(fn) && countNodeLines(sourceFile, fn) <= SHORT_ARROW_LINES
}

/** 한 글자 이름이거나, 금지 약어이거나, 뜻 없는 이름에 숫자를 붙인 것인가. */
export function isShortIdentifier(name, bannedNames) {
  if (name.length === 1 && /[A-Za-z]/.test(name)) return true
  if (bannedNames.has(name)) return true
  const stem = name.replace(/\d+$/, '')
  return stem !== name && (NUMBERED_STEMS.has(stem) || bannedNames.has(stem))
}

/** 이름을 새로 만드는 선언 노드 → 그 이름(Identifier). 가져오기 · 타입 매개변수 · 속성 이름은 세지 않는다. */
function readDeclaredName(node) {
  if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) return ts.isIdentifier(node.name) ? node.name : null
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node) || ts.isMethodDeclaration(node)) {
    return node.name && ts.isIdentifier(node.name) ? node.name : null
  }
  return null
}

// ── 이력 주석 ────────────────────────────────────────────

const LITERAL_KIND_NAMES = ['StringLiteral', 'NoSubstitutionTemplateLiteral', 'TemplateHead', 'TemplateMiddle', 'TemplateTail', 'RegularExpressionLiteral', 'JsxText']

/** 문자열 · 정규식 · JSX 글자의 [시작, 끝] 목록(시작 순). 이 안의 `//` · `/*` 는 주석이 아니다. */
function findLiteralRanges(sourceFile) {
  const literalKinds = new Set(LITERAL_KIND_NAMES.map((name) => ts.SyntaxKind[name]))
  const ranges = []
  const visit = (node) => {
    if (literalKinds.has(node.kind)) ranges.push([node.getStart(sourceFile), node.getEnd()])
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return ranges.sort((left, right) => left[0] - right[0])
}

/** 소스 조각의 주석 본문 목록. */
export function findComments(sourceFile, text) {
  const ranges = findLiteralRanges(sourceFile)
  const comments = []
  const commentRe = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g
  let next = 0 // 아직 지나지 않은 첫 글자 범위
  for (let match = commentRe.exec(text); match; match = commentRe.exec(text)) {
    while (next < ranges.length && ranges[next][1] <= match.index) next++
    if (next < ranges.length && ranges[next][0] <= match.index) {
      commentRe.lastIndex = ranges[next][1]
      continue
    }
    comments.push(match[0])
  }
  return comments
}

/** 주석 한 개 → 이력 표식이 든 줄 수. 한 줄은 한 번만 세고, 예외 패턴이 든 줄은 세지 않는다. */
export function countHistoryLines(comment, rules) {
  const isHistory = (line) => !rules.historyExemptRes.some((pattern) => pattern.test(line)) && rules.historyRes.some((pattern) => pattern.test(line))
  return splitLines(comment).filter(isHistory).length
}

// ── 머리 주석 ────────────────────────────────────────────

const DIRECTIVE_RE = /^\/[/*]\s*(eslint|@ts-|prettier|istanbul|c8|#region|@vitest)/

/** 글 맨 앞이 주석으로 시작하는가. 도구에 내리는 지시 주석(eslint · ts)은 머리 주석으로 보지 않고 건너뛴다. */
function startsWithComment(text) {
  let rest = text.replace(/^﻿/, '').replace(/^#![^\n]*\n/, '')
  for (;;) {
    rest = rest.trimStart()
    const comment = /^(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/.exec(rest)?.[1]
    if (!comment) return false
    if (!DIRECTIVE_RE.test(comment)) return true
    rest = rest.slice(comment.length)
  }
}

/** 파일에 머리 주석이 있는가. Vue 는 맨 앞 <!-- --> 이나 <script> 블록 맨 앞 주석을 인정한다. */
export function hasFileHeader(file, text, chunks) {
  if (!file.endsWith('.vue')) return startsWithComment(text)
  if (/^\s*<!--/.test(text)) return true
  return chunks.some((chunk) => startsWithComment(chunk.text))
}

// ── 조각 한 개 측정 ──────────────────────────────────────

/** 스크립트 조각 하나를 재서 counts 의 params · shortIds · history 에 더한다. */
export function measureReadable(sourceFile, text, counts, rules) {
  const typeSizes = readLocalTypeSizes(sourceFile)
  const visit = (node) => {
    const isOverLimit = ts.isFunctionLike(node) && node.body && isParamsOverLimit(node, typeSizes, { sourceFile, rules })
    if (isOverLimit || countDefineProps(node, typeSizes) > rules.maxProps) counts.params++
    const declared = readDeclaredName(node)
    if (declared && isShortIdentifier(declared.text, rules.bannedNames) && !isAllowedShort(declared.text, node, sourceFile)) counts.shortIds++
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  for (const comment of findComments(sourceFile, text)) counts.history += countHistoryLines(comment, rules)
}
