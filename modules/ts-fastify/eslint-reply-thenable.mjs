// ESLint 규칙 lanekit/no-reply-thenable — Fastify 의 reply 를 Promise 처럼 받아 그 값을 쓰는 코드를 잡는다.
// 부르는 곳: 프로젝트의 eslint.config.mjs. 타입 정보가 있는 설정 블록에 replyThenableRules({ ts, files }) 를 넣는다.
// 먼저 읽을 파일: module.json 의 eslint 칸(넣는 법), route-rules.mjs(같은 모듈의 구조 지표).
//
// reply 에는 then 메서드가 있다. 그래서 reply 를 await 하면 reply 가 아니라 then 이 넘긴 값(없음)이 나온다.
// 「거절했으면 reply, 아니면 null」을 돌려주는 async 관문을 `if (await guard()) return` 으로 받으면 조건이 늘 거짓이 된다.
// 그러면 거절 응답을 보낸 뒤에도 처리가 계속된다. 관문은 boolean 을 돌려주게 쓴다.
//
// 잡는 것(값을 쓰는 자리만. 버리는 `await reply.send()` 문장과 그대로 돌려주는 `return await …` 는 두고 본다)
//   1. await 하는 식의 타입(Promise 를 벗긴 것)에 FastifyReply 가 있다.
//   2. await 하는 식이 「reply 관문」의 호출이다. 관문은 reply 를 돌려주는 곳과 빈 값으로 끝나는 곳이 함께 있는 async 함수다.
//      async 함수가 추론한 반환 타입에는 reply 가 남지 않아서 1번으로는 찾지 못한다.
//   3. 1 · 2 에 해당하는 식에 `.then()` · `.catch()` · `.finally()` 를 붙였거나, 그 식을 `Promise.all([…])` 에 넣었다.
// 한계: 관문 호출을 다시 감싼 함수와, 타입 없이 매개변수로 넘겨받은 함수는 선언을 따라가지 않는다.

const REPLY_TYPE_NAME = 'FastifyReply'
const CHAIN_METHODS = ['then', 'catch', 'finally']
const COMBINATORS = ['all', 'allSettled', 'race', 'any']

/** 타입에 FastifyReply 가 들어 있는가. 유니온 · 인터섹션은 구성 타입을 하나씩 본다. */
export function isReplyType(type) {
  if (!type) return false
  if (type.isUnionOrIntersection()) return type.types.some(isReplyType)
  return (type.aliasSymbol ?? type.getSymbol())?.name === REPLY_TYPE_NAME
}

/** Promise<T> 를 한 겹씩 벗겨 가며 reply 타입이 나오는지 본다. */
function holdsReply(checker, type) {
  if (isReplyType(type)) return true
  if (type.isUnion()) return type.types.some((member) => holdsReply(checker, member))
  const name = type.getSymbol()?.name
  if (name !== 'Promise' && name !== 'PromiseLike') return false
  return checker.getTypeArguments(type).some((argument) => holdsReply(checker, argument))
}

/** 괄호 · await · 타입 단언을 벗긴 안쪽 식. */
function unwrap(ts, expression) {
  let inner = expression
  while (ts.isParenthesizedExpression(inner) || ts.isAwaitExpression(inner) || ts.isAsExpression(inner) || ts.isNonNullExpression(inner)) {
    inner = inner.expression
  }
  return inner
}

/** 함수 자신의 return 문(안쪽 함수의 것은 뺀다). */
function findOwnReturns(ts, fn) {
  const returns = []
  const visit = (node) => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return
    if (ts.isReturnStatement(node)) returns.push(node)
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(fn.body, visit)
  return returns
}

function isEmptyValue(ts, expression) {
  if (!expression) return true
  const inner = unwrap(ts, expression)
  const isNothing = inner.kind === ts.SyntaxKind.NullKeyword || inner.kind === ts.SyntaxKind.FalseKeyword
  return isNothing || ts.isVoidExpression(inner) || (ts.isIdentifier(inner) && inner.text === 'undefined')
}

/** 본문의 끝까지 가서 값 없이 끝날 수 있는가. 마지막 문장이 return 이나 throw 가 아니면 그렇다고 본다. */
function canFallThrough(ts, fn) {
  const last = fn.body.statements.at(-1)
  return !last || !(ts.isReturnStatement(last) || ts.isThrowStatement(last))
}

/** reply 관문인가: 블록 본문을 가진 async 함수이고, reply 를 돌려주는 return 과 빈 값으로 끝나는 길이 함께 있다. */
export function isReplyGate(ts, checker, fn) {
  const isAsync = (ts.getCombinedModifierFlags(fn) & ts.ModifierFlags.Async) !== 0
  if (!isAsync || !fn.body || !ts.isBlock(fn.body)) return false
  const returns = findOwnReturns(ts, fn)
  const repliesSomewhere = returns.some((statement) => statement.expression && isReplyType(checker.getTypeAtLocation(unwrap(ts, statement.expression))))
  const endsEmptySomewhere = canFallThrough(ts, fn) || returns.some((statement) => isEmptyValue(ts, statement.expression))
  return repliesSomewhere && endsEmptySomewhere
}

/** 식이 reply 를 Promise 로 받게 만드는가(위 설명의 1 · 2). */
export function yieldsReply(ts, checker, expression) {
  if (holdsReply(checker, checker.getTypeAtLocation(expression))) return true
  const inner = unwrap(ts, expression)
  if (!ts.isCallExpression(inner)) return false
  const declaration = checker.getResolvedSignature(inner)?.declaration
  return !!declaration && ts.isFunctionLike(declaration) && isReplyGate(ts, checker, declaration)
}

/** await 식의 결과를 쓰는가. 버리는 문장 · 그대로 돌려주기 · void 는 쓰지 않는 것으로 본다. */
export function isAwaitValueUsed(ts, awaitNode) {
  let parent = awaitNode.parent
  while (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isNonNullExpression(parent)) parent = parent.parent
  if (ts.isExpressionStatement(parent) || ts.isReturnStatement(parent) || ts.isVoidExpression(parent)) return false
  return !(ts.isArrowFunction(parent) && parent.body === awaitNode)
}

/** 호출이 reply 를 Promise 로 다루는가(위 설명의 3). */
export function chainsOnReply(ts, checker, call) {
  const callee = call.expression
  if (!ts.isPropertyAccessExpression(callee)) return false
  if (CHAIN_METHODS.includes(callee.name.text)) return yieldsReply(ts, checker, callee.expression)
  const isCombinator = ts.isIdentifier(callee.expression) && callee.expression.text === 'Promise' && COMBINATORS.includes(callee.name.text)
  const list = call.arguments[0]
  if (!isCombinator || !list || !ts.isArrayLiteralExpression(list)) return false
  return list.elements.some((element) => !ts.isSpreadElement(element) && yieldsReply(ts, checker, element))
}

/** 구문 트리 노드 하나가 이 규칙에 걸리는가. ESLint 없이도 부를 수 있다. */
export function isReplyThenableUse(ts, checker, node) {
  if (ts.isAwaitExpression(node)) return isAwaitValueUsed(ts, node) && yieldsReply(ts, checker, node.expression)
  return ts.isCallExpression(node) && chainsOnReply(ts, checker, node)
}

const MESSAGE =
  'A Fastify reply has a then method, so awaiting it yields undefined instead of the reply. Return a boolean from the guard and let the caller return the reply.'

/** ESLint 플러그인을 만든다. ts 는 프로젝트의 typescript 모듈이다(타입 정보가 있는 파서 설정이 필요하다). */
export function createPlugin(ts) {
  const rule = {
    meta: {
      type: 'problem',
      docs: { description: 'Disallow using a Fastify reply as a promise' },
      schema: [],
      messages: { thenable: MESSAGE },
    },
    create(context) {
      const services = context.sourceCode.parserServices
      if (!services?.program || !services.esTreeNodeToTSNodeMap) return {}
      const checker = services.program.getTypeChecker()
      const report = (node) => {
        const tsNode = services.esTreeNodeToTSNodeMap.get(node)
        if (tsNode && isReplyThenableUse(ts, checker, tsNode)) context.report({ node, messageId: 'thenable' })
      }
      return { AwaitExpression: report, CallExpression: report }
    },
  }
  return { rules: { 'no-reply-thenable': rule } }
}

/** flat config 조각. 타입 정보가 있는 설정 블록과 같은 files 에 건다. */
export function replyThenableRules({ ts, files }) {
  return { files, plugins: { lanekit: createPlugin(ts) }, rules: { 'lanekit/no-reply-thenable': 'error' } }
}
