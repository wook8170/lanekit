// 통합 테스트(ts 모듈) — TypeScript 저장소에서 init 부터 출하 게이트까지를 한 흐름으로 확인한다.
// 대상: structure 검사가 프로젝트의 typescript 로 재는 값, 그 값의 래칫과 재잠금.
// 먼저 읽을 파일: e2e-helpers.mjs 의 assertRatchetJourney, structure-helpers.mjs 의 fnSource.
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { assertRatchetJourney, scaffoldProject } from './e2e-helpers.mjs'
import { fnSource } from './structure-helpers.mjs'

const HEAD = '// 주문 합계를 계산한다.\n// 부르는 곳: 주문 서비스.\n// 먼저 읽을 파일: 없음.\n'
const OVER_LIMIT_LINES = 150
const FILES = {
  'package.json': { name: 'acme-app', devDependencies: { typescript: '^6.0.0' } },
  'tsconfig.json': { compilerOptions: { strict: true } },
  'src/orders.ts': HEAD + fnSource('sumOrders', OVER_LIMIT_LINES),
}

test('ts: init → light → 잠금 → 상한을 넘는 새 함수 → 래칫 실패 → 재잠금 → full', async () => {
  const project = await scaffoldProject({ files: FILES, modules: ['ts'] })
  assertRatchetJourney(project, {
    checkId: 'structure',
    grownRule: 'fnLines',
    violate: (dir) => appendFileSync(join(dir, 'src/orders.ts'), fnSource('sumRefunds', OVER_LIMIT_LINES)),
  })
})
