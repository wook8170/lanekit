// 라우트 지표와 ESLint 규칙 테스트 — ts-fastify 모듈이 켜졌을 때만 라우트 지표가 나오는지, reply 를 Promise 로 받는 코드를 잡는지 본다.
// 대상: modules/ts-fastify/ 의 route-rules.mjs · eslint-reply-thenable.mjs 와 structure 검사의 라우트 규칙 4종.
// 먼저 읽을 파일: structure-helpers.mjs, fixtures/acme-app/README.md(가상 프로젝트의 라우트 파일).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { measureSource } from '../kit/checks/structure/measure.mjs'
import { createPlugin, isReplyThenableUse, replyThenableRules } from '../modules/ts-fastify/eslint-reply-thenable.mjs'
import { createRouteRules } from '../modules/ts-fastify/route-rules.mjs'
import { copyFixture, makeTempDir, readJson, writeFiles } from './helpers.mjs'
import { byKey, increasesAgainst, LANEKIT_ROOT, REPLY_SOURCE, runStructure, structureConfig, structureOptions, useTypescript, valuesOf } from './structure-helpers.mjs'

const ts = useTypescript()

const HEAD = '// 머리 주석\n'
const ROUTE = 'src/routes/x.ts'
const routeRulesWith = (overrides = {}) => createRouteRules(ts, structureOptions({ routes: overrides }).routes)
const measureRoute = (source, routeRules = routeRulesWith()) => measureSource(ROUTE, source, { routeRules })

test('라우트 파일 — 라우트 수 · 처리 함수 종류 · DB 직접 호출', () => {
  const source = "export async function r(app) {\n app.get('/a', async () => db.get('x'))\n app.post(`/b/${1}`, async () => { await tx.run('y') })\n app.route({ method: 'GET', url: '/c', handler: async () => 1 })\n m.get('k')\n app.get(key)\n}\n"
  const measured = measureRoute(source)
  assert.equal(measured.routes, 3, 'm 은 라우트를 다는 객체가 아니고, 경로가 아닌 인자는 세지 않는다')
  assert.equal(measured.db, 2)
  assert.equal(byKey(measured)['r>app.get(/a)=>'].kind, 'route')
  assert.equal(byKey(measured)['r>handler'].kind, 'route')
  assert.equal(byKey(measured).r.kind, 'fn')
})

test('라우트 규칙을 넘기지 않으면 라우트와 DB 호출을 세지 않는다', () => {
  const measured = measureSource(ROUTE, "export function r(app) { app.get('/a', async () => db.get('x')) }\n")
  assert.deepEqual([measured.routes, measured.db, measured.dbIndirect], [0, 0, 0])
  assert.equal(byKey(measured)['r>app.get(/a)=>'].kind, 'fn')
})

test('앱 객체를 거친 DB 호출은 따로 세고, 직접 호출과 겹치지 않는다', () => {
  const source = "export function r(app) {\n app.get('/a', async (req) => { await app.db.get('x'); await req.server.db.run('y'); await db.all('z') })\n app.db.withTransaction(async () => {})\n m.get('k')\n}\n"
  const byDefault = measureRoute(source)
  assert.deepEqual([byDefault.db, byDefault.dbIndirect], [1, 2], '기본 패턴은 app.db. 만 본다')
  const anyOwner = measureRoute(source, routeRulesWith({ appDbPattern: '(^|\\.)db\\.' }))
  assert.deepEqual([anyOwner.db, anyOwner.dbIndirect], [1, 3])
})

test('라우트를 다는 객체와 DB 객체의 이름은 설정을 따른다', () => {
  const source = "export function r(api) { api.get('/a', async () => pool.query('x')) }\n"
  assert.deepEqual([measureRoute(source).routes, measureRoute(source).db], [0, 0])
  const custom = measureRoute(source, routeRulesWith({ owners: ['api'], dbOwners: ['pool'], dbMethods: ['query'] }))
  assert.deepEqual([custom.routes, custom.db], [1, 1])
})

test('래칫 — 라우트의 DB 호출은 늘면 실패하고, 라우트 파일이 아닌 곳은 세지 않는다', () => {
  const one = { [ROUTE]: `${HEAD}export function r(app){ app.get('/a', () => app.db.get('q')) }\n` }
  const two = { [ROUTE]: `${HEAD}export function r(app){ app.get('/a', () => app.db.get('q')); app.get('/b', () => { db.all('q'); return app.db.all('q') }) }\n` }
  const routes = { routeRules: routeRulesWith(), routeFiles: [ROUTE] }
  const base = valuesOf(one, routes)
  assert.deepEqual([base.routeDbIndirect, base.routeDb], [{ [ROUTE]: 1 }, {}])
  assert.deepEqual(increasesAgainst(valuesOf(two, routes), base).increased.sort(), [`routeDb ${ROUTE}`, `routeDbIndirect ${ROUTE}`])
  const elsewhere = valuesOf(two, { routeRules: routeRulesWith(), routeFiles: [] })
  assert.deepEqual([elsewhere.routeDb, elsewhere.routeDbIndirect], [{}, {}])
})

test('래칫 — 서버 소스의 최상위 폴더에 새 파일을 두면 실패한다', () => {
  const settings = { routeRules: routeRulesWith(), isServerTop: (file) => /^src\/[^/]+\.ts$/.test(file) }
  const base = valuesOf({ 'src/old.ts': `${HEAD}export const first = 1\n` }, settings)
  assert.deepEqual(base.serverTop, { 'src/old.ts': 1 })
  const next = valuesOf({ 'src/old.ts': `${HEAD}export const first = 1\n`, 'src/new-top.ts': `${HEAD}export const second = 1\n`, 'src/svc/deep.ts': `${HEAD}export const third = 1\n` }, settings)
  assert.deepEqual(increasesAgainst(next, base).increased, ['serverTop src/new-top.ts'])
})

const SMALL_ROUTE_LIMITS = { routesPerFile: 1, route: { warn: 2, fail: 3 }, serverTop: 'src/*.mjs' }
const ROUTE_RULES = ['routesPerFile', 'routeDb', 'routeDbIndirect', 'serverTop']

test('게이트 — ts-fastify 를 켜면 가상 프로젝트의 라우트 지표가 손으로 센 값과 같다', async () => {
  const dir = copyFixture()
  writeFiles(dir, { 'lanekit.config.json': structureConfig({ modules: ['ts', 'ts-fastify'], structure: { routes: SMALL_ROUTE_LIMITS } }) })
  const { outcome } = await runStructure(dir)
  assert.deepEqual(outcome.current.routesPerFile, { 'src/routes/orders.ts': 2 })
  assert.deepEqual(outcome.current.routeDb, { 'src/routes/orders.ts': 1 })
  assert.deepEqual(outcome.current.routeDbIndirect, { 'src/routes/orders.ts': 1 })
  assert.deepEqual(outcome.current.serverTop, { 'src/index.mjs': 1 })
  assert.deepEqual(outcome.current.fnLines, { 'src/routes/orders.ts#registerOrders>app.post(/orders)=>': 4 }, '라우트 처리 함수는 라우트 상한(3줄)으로 본다')
  assert.deepEqual(ROUTE_RULES.map((rule) => outcome.metrics[rule]), [1, 1, 1, 1])
})

test('게이트 — ts-fastify 를 끄면 라우트 지표가 나오지 않는다', async () => {
  const dir = copyFixture()
  writeFiles(dir, { 'lanekit.config.json': structureConfig({ modules: ['ts'], structure: { routes: SMALL_ROUTE_LIMITS } }) })
  const { outcome } = await runStructure(dir)
  for (const rule of ROUTE_RULES) {
    assert.equal(rule in outcome.current, false, `${rule} 은 값에 없어야 한다`)
    assert.equal(rule in outcome.metrics, false, `${rule} 은 지표에 없어야 한다`)
  }
  assert.deepEqual(outcome.current.fnLines, {}, '라우트 상한을 쓰지 않으면 4줄인 처리 함수는 걸리지 않는다')
  assert.equal(outcome.findings.some((found) => ROUTE_RULES.includes(found.rule)), false)
})

test('게이트 — appDbPattern 이 틀린 정규식이면 검사가 오류로 끝난다', async () => {
  const dir = copyFixture()
  writeFiles(dir, { 'lanekit.config.json': structureConfig({ modules: ['ts', 'ts-fastify'], structure: { routes: { appDbPattern: '(' } } }) })
  const { code, outcome } = await runStructure(dir)
  assert.equal(code, 1)
  assert.equal(outcome.status, 'error')
})

test('모듈 정의 — 설정 기본값이 스키마의 기본값과 같고, 적힌 파일이 모두 있다', () => {
  const defaults = structureOptions()
  const coreModule = readJson(join(LANEKIT_ROOT, 'modules/ts/module.json'))
  const routesModule = readJson(join(LANEKIT_ROOT, 'modules/ts-fastify/module.json'))
  assert.deepEqual(coreModule.config.checks.structure.source, defaults.source)
  assert.deepEqual(routesModule.config.checks.structure.routes, defaults.routes)
  assert.deepEqual(routesModule.requires, ['ts'])
  for (const [name, definition] of [['ts', coreModule], ['ts-fastify', routesModule]]) {
    assert.equal(definition.name, name)
    for (const file of definition.files) assert.equal(existsSync(join(LANEKIT_ROOT, 'modules', name, file)), true, `${name}/${file}`)
  }
})

test('복사본 — kit 과 켠 모듈을 scripts/lanekit 로 복사해도 라우트 지표가 나온다', () => {
  const dir = copyFixture()
  writeFiles(dir, { 'lanekit.config.json': structureConfig({ modules: ['ts', 'ts-fastify'] }) })
  cpSync(join(LANEKIT_ROOT, 'kit'), join(dir, 'scripts/lanekit'), { recursive: true })
  for (const name of ['ts', 'ts-fastify']) cpSync(join(LANEKIT_ROOT, 'modules', name), join(dir, 'scripts/lanekit/modules', name), { recursive: true })
  const ran = spawnSync(process.execPath, ['scripts/lanekit/gate.mjs', '--only', 'structure', '--no-evidence', '--json', 'result.json'], { cwd: dir, encoding: 'utf8' })
  assert.equal(ran.status, 0, ran.stderr)
  const outcome = readJson(join(dir, 'result.json')).outcomes.find((entry) => entry.id === 'structure')
  assert.deepEqual(outcome.current.routeDb, { 'src/routes/orders.ts': 1 })
  assert.equal(outcome.metrics.files, 6, '복사한 scripts/lanekit 아래는 재지 않는다')
})

// ── ESLint 규칙 ─────────────────────────────────────────

function compileReplySource() {
  const dir = makeTempDir()
  writeFiles(dir, { 'handler.ts': REPLY_SOURCE })
  const program = ts.createProgram([join(dir, 'handler.ts')], { strict: true, target: ts.ScriptTarget.ES2022, noEmit: true })
  return { program, sourceFile: program.getSourceFile(join(dir, 'handler.ts')) }
}

function findNodes(sourceFile, matches) {
  const nodes = []
  const visit = (node) => {
    if (matches(node)) nodes.push(node)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return nodes
}

test('no-reply-thenable — reply 나 reply 관문을 await · then · Promise.all 로 받아 값을 쓰는 줄만 잡는다', () => {
  const { program, sourceFile } = compileReplySource()
  const checker = program.getTypeChecker()
  const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  const hitLines = findNodes(sourceFile, (node) => isReplyThenableUse(ts, checker, node)).map(lineOf)
  const expected = REPLY_SOURCE.split('\n').flatMap((line, index) => (line.endsWith('// hit') ? [index + 1] : []))
  assert.equal(expected.length, 7)
  assert.deepEqual([...new Set(hitLines)].sort((left, right) => left - right), expected)
})

test('no-reply-thenable — 플러그인은 구문 트리 짝이 있는 노드만 보고하고, 타입 정보가 없으면 아무것도 하지 않는다', () => {
  const { program, sourceFile } = compileReplySource()
  const lineTextOf = (node) => REPLY_SOURCE.split('\n')[sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line].trim()
  const awaitOn = (lineText) => findNodes(sourceFile, (node) => ts.isAwaitExpression(node) && lineTextOf(node) === lineText)[0]
  const [hit, discarded] = [awaitOn('const rejected = await replyGate() // hit'), awaitOn('await reply.send()')]
  const esHit = { type: 'AwaitExpression', id: 'hit' }
  const esDiscarded = { type: 'AwaitExpression', id: 'discarded' }
  const reported = []
  const parserServices = { program, esTreeNodeToTSNodeMap: new Map([[esHit, hit], [esDiscarded, discarded]]) }
  const rule = createPlugin(ts).rules['no-reply-thenable']
  const visitors = rule.create({ sourceCode: { parserServices }, report: (problem) => reported.push(problem) })
  visitors.AwaitExpression(esHit)
  visitors.AwaitExpression(esDiscarded)
  visitors.CallExpression({ type: 'CallExpression', id: 'unmapped' })
  assert.deepEqual(reported, [{ node: esHit, messageId: 'thenable' }])
  assert.deepEqual(rule.create({ sourceCode: { parserServices: {} }, report: () => {} }), {})
  const flat = replyThenableRules({ ts, files: ['src/**/*.ts'] })
  assert.deepEqual(flat.rules, { 'lanekit/no-reply-thenable': 'error' })
  assert.deepEqual([flat.files, Object.keys(flat.plugins.lanekit.rules)], [['src/**/*.ts'], ['no-reply-thenable']])
})
