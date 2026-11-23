// Fastify 라우트 지표 — 호출 하나가 라우트 정의인지, 라우트 파일 안의 DB 호출인지 판정한다.
// 부르는 곳: structure 검사의 run.mjs 가 이 파일을 읽어, 라우트 파일을 잴 때 measure.mjs 에 넘긴다.
// 먼저 읽을 파일: module.json(설정 기본값), structure 검사의 measure.mjs(tallyCall · isRouteHandler 를 부르는 곳).
//
// 라우트 파일은 요청 검증 · 권한 검사 · 응답만 맡고, DB 는 서비스 파일을 거쳐 닿는다는 기준을 잰다.
// 세는 것: 라우트 정의 수 · DB 직접 호출(`db.get(` · `tx.run(`) · 앱 객체를 거친 DB 호출(`app.db.get(`).

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all']
// 라우트 정의에 넘긴 이름 없는 처리 함수는 measure.mjs 가 `app.get(/경로)=>` 모양으로 이름을 붙인다.
const ROUTE_CALLBACK_RE = new RegExp(`^\\w+\\.(${HTTP_METHODS.join('|')})\\(/[^)]*\\)=>$`)

function startsWithSlash(ts, argument) {
  const isPathLiteral = ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument) || ts.isTemplateExpression(argument)
  return isPathLiteral && (argument.text ?? argument.head?.text ?? '').startsWith('/')
}

/** 라우트 정의인가: `app.get('/…'` · `fastify.post(\`/…\`` · `app.route({ … })`. 첫 인자가 경로이거나 route 객체일 때만 센다. */
function isRouteDefinition(ts, rules, call) {
  const callee = call.expression
  const owner = ts.isIdentifier(callee.expression) ? callee.expression.text : ''
  if (!rules.owners.has(owner)) return false
  const firstArg = call.arguments[0]
  if (!firstArg) return false
  if (callee.name.text === 'route') return ts.isObjectLiteralExpression(firstArg)
  return HTTP_METHODS.includes(callee.name.text) && startsWithSlash(ts, firstArg)
}

/** DB 호출의 종류: 'direct'(`db.get(`) · 'indirect'(앱 객체를 거친 호출) · null(DB 호출이 아님). */
function classifyDbCall(ts, rules, call) {
  const callee = call.expression
  if (!rules.dbMethods.has(callee.name.text)) return null
  if (ts.isIdentifier(callee.expression)) return rules.dbOwners.has(callee.expression.text) ? 'direct' : null
  return rules.appDb.test(callee.getText()) ? 'indirect' : null
}

/**
 * 설정 checks.structure.routes 로 라우트 규칙을 만든다. ts 는 프로젝트의 typescript 모듈이다.
 * 돌려주는 것: tallyCall(call, counts) 는 counts 의 routes · db · dbIndirect 를 올리고,
 * isRouteHandler(node, name) 은 함수가 라우트 처리 함수인지 답한다.
 */
export function createRouteRules(ts, routes) {
  const rules = {
    owners: new Set(routes.owners),
    dbOwners: new Set(routes.dbOwners),
    dbMethods: new Set(routes.dbMethods),
    appDb: new RegExp(routes.appDbPattern),
  }
  const tallyCall = (call, counts) => {
    if (!ts.isPropertyAccessExpression(call.expression)) return
    if (isRouteDefinition(ts, rules, call)) counts.routes++
    const dbCall = classifyDbCall(ts, rules, call)
    if (dbCall === 'direct') counts.db++
    else if (dbCall === 'indirect') counts.dbIndirect++
  }
  const isRouteHandler = (node, name) => ROUTE_CALLBACK_RE.test(name) || (name === 'handler' && ts.isPropertyAssignment(node.parent))
  return { tallyCall, isRouteHandler }
}
