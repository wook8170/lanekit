// 통합 테스트(ts-fastify 모듈) — Fastify 저장소에서 init 부터 출하 게이트까지를 한 흐름으로 확인한다.
// 대상: 복사된 ts-fastify 모듈의 라우트 지표, 그 값의 래칫과 재잠금.
// 먼저 읽을 파일: e2e-helpers.mjs 의 assertRatchetJourney, ../modules/ts-fastify/route-rules.mjs.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { assertRatchetJourney, scaffoldProject } from './e2e-helpers.mjs'
import { readJson, writeFiles } from './helpers.mjs'

const HEAD = '// 사용자 라우트를 등록한다.\n// 부르는 곳: 서버 시작.\n// 먼저 읽을 파일: 없음.\n'
const ROUTE_FILE = 'src/routes/users.ts'
const ONE_ROUTE = `${HEAD}export function registerUsers(app) {\n  app.get('/users', async () => app.db.all('users'))\n}\n`
const TWO_ROUTES = `${HEAD}export function registerUsers(app) {\n  app.get('/users', async () => app.db.all('users'))\n  app.get('/users/count', async () => app.db.get('count'))\n}\n`
const FILES = {
  'package.json': { name: 'acme-app', dependencies: { fastify: '^5.0.0' }, devDependencies: { typescript: '^6.0.0' } },
  [ROUTE_FILE]: ONE_ROUTE,
}

test('ts-fastify: init → light → 잠금 → 라우트의 DB 호출 추가 → 래칫 실패 → 재잠금 → full', async () => {
  const project = await scaffoldProject({ files: FILES, modules: ['ts', 'ts-fastify'] })
  assert.ok(existsSync(join(project.dir, 'scripts/lanekit/modules/ts-fastify/route-rules.mjs')), '켠 모듈의 파일을 복사한다')
  const locked = readJson(join(project.dir, 'scripts/lanekit/baselines/structure.json')).values
  assert.deepEqual(locked.routeDbIndirect, { [ROUTE_FILE]: 1 })
  assertRatchetJourney(project, {
    checkId: 'structure',
    grownRule: 'routeDbIndirect',
    violate: (dir) => writeFiles(dir, { [ROUTE_FILE]: TWO_ROUTES }),
  })
})
