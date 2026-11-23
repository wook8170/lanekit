// 구조 측정 테스트 — 파일 한 개의 수치(줄 수 · 함수 · 복잡도 · 중첩 · 훅 · 빈 catch · console · import)와 검사의 진입 조건을 본다.
// 대상: kit/checks/structure/ 의 measure.mjs · source.mjs · typescript.mjs · run.mjs.
// 먼저 읽을 파일: structure-helpers.mjs, fixtures/acme-app/README.md(가상 프로젝트에 넣어 둔 것).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countLines, measureSource } from '../kit/checks/structure/measure.mjs'
import { selectSources } from '../kit/checks/structure/source.mjs'
import { createMatcher } from '../kit/lib/glob.mjs'
import { hasCompilerApi, locateTypescript } from '../kit/checks/structure/typescript.mjs'
import { commitAll, copyFixture, makeProject, writeFiles } from './helpers.mjs'
import { byKey, fnSource, LANEKIT_ROOT, runStructure, structureConfig, structureOptions, useTypescript } from './structure-helpers.mjs'

useTypescript()

test('줄 수 — 마지막 줄바꿈은 줄로 세지 않는다', () => {
  assert.equal(countLines('a\nb\n'), 2)
  assert.equal(countLines('a\nb'), 2)
  assert.equal(countLines(''), 0)
})

test('함수 길이와 키 — 키는 이름 기준이라 위에 줄이 늘어도 같다', () => {
  const before = measureSource('x/a.ts', fnSource('alpha', 10) + fnSource('beta', 3))
  const after = measureSource('x/a.ts', `\n\n// 머리말\n${fnSource('alpha', 10)}${fnSource('beta', 3)}`)
  assert.equal(byKey(before).alpha.lines, 12)
  assert.deepEqual(Object.keys(byKey(before)), Object.keys(byKey(after)))
  assert.equal(byKey(after).alpha.lines, 12)
  assert.equal(byKey(after).alpha.line, 4, '함수가 시작하는 줄 번호')
})

test('같은 이름의 함수에는 순번, 콜백에는 부른 곳 이름, 안쪽 함수에는 바깥 이름을 붙인다', () => {
  const measured = measureSource('x/a.ts', 'function f(){ xs.map(() => 1); xs.map(() => 2) }\nclass C { m() { const g = () => 0 } }\n')
  assert.deepEqual(measured.functions.map((fn) => fn.key), ['f', 'f>xs.map=>', 'f>xs.map=>#2', 'C.m', 'C.m>g'])
})

test('복잡도와 중첩 — 분기와 논리 연산을 세고 else if 는 깊이를 더하지 않는다', () => {
  const source = 'function f(a,b){ if (a) { for (const x of b) { while (x) { if (x && a) { try { a() } catch (e) { b() } } } } } else if (b) {} return a ?? b }'
  const measured = byKey(measureSource('x/a.ts', source)).f
  assert.equal(measured.complexity, 9, '1 + if · for · while · if · && · catch · else if · ??')
  assert.equal(measured.depth, 5, 'if > for > while > if > try')
})

test('React 컴포넌트와 훅 수, Vue <script setup> 은 템플릿 줄까지 컴포넌트 하나로 센다', () => {
  const react = measureSource('x/A.tsx', 'export function Panel() { const [a] = useState(0); useEffect(() => {}); return <div>{a}</div> }\nfunction helper() { return 1 }\n')
  assert.equal(byKey(react).Panel.kind, 'component')
  assert.equal(byKey(react).Panel.hooks, 2)
  assert.equal(byKey(react).helper.kind, 'fn')
  const vue = measureSource('x/B.vue', '<template>\n  <div>\n  </div>\n</template>\n<script setup lang="ts">\nconst a = useFoo()\nconst b = ref(1)\n</script>\n')
  const setup = byKey(vue)['<script setup>']
  assert.equal(setup.kind, 'component')
  assert.equal(setup.hooks, 1)
  assert.equal(setup.lines, 4 + 2, '템플릿 4줄 + 스크립트 2줄')
})

test('빈 catch · 아무 일도 하지 않는 .catch() · console · 값과 타입 import', () => {
  const source = "import type { A } from './a.js'\nimport { type B } from './b.js'\nimport { c } from './c.js'\nexport { d } from './d.js'\ntry { x() } catch { /* 무시 */ }\np.catch(() => {})\np.catch(() => undefined)\np.catch((e) => log(e))\nconsole.log(1)\n"
  const measured = measureSource('x/a.ts', source)
  assert.equal(measured.emptyCatch, 3)
  assert.equal(measured.console, 1)
  assert.deepEqual(measured.imports.map((imported) => [imported.spec, imported.typeOnly]), [['./a.js', true], ['./b.js', true], ['./c.js', false], ['./d.js', false]])
})

test('오류를 기록하는 catch 는 세지 않고, 주석만 있는 catch 와 .catch(() => null) 은 센다', () => {
  const measure = (source) => measureSource('src/x.ts', source)
  assert.equal(measure("try { f() } catch (e) { logError('x', e) }\n").emptyCatch, 0)
  assert.equal(measure("p.catch((e) => logError('x', e))\n").emptyCatch, 0)
  assert.equal(measure("p.catch((e) => { logError('x', e); return null })\n").emptyCatch, 0)
  assert.equal(measure('try { f() } catch { /* 주석만 */ }\n').emptyCatch, 1)
  assert.equal(measure('p.catch(() => null)\n').emptyCatch, 1)
  assert.equal(measure('p.catch(() => void 0)\n').emptyCatch, 1)
  const traced = measure("debugTrace('x')\nconsole.debug('x')\n")
  assert.equal(traced.emptyCatch, 0)
  assert.equal(traced.console, 1)
})

test('readable 규칙을 넘기지 않으면 읽기 쉬운 코드 지표를 재지 않는다', () => {
  const measured = measureSource('x/a.ts', 'const d = 1\n// v2.0 주석\n')
  assert.deepEqual([measured.params, measured.shortIds, measured.history, measured.hasHeader], [0, 0, 0, true])
})

test('대상 고르기 — include · exclude 글롭과 확장자', () => {
  const { source } = structureOptions()
  const files = ['src/a.ts', 'src/a.test.ts', 'src/types.d.ts', 'src/deep/b.vue', 'apps/web/src/c.tsx', 'apps/web/dist/c.js', 'packages/core/src/generated/d.ts', 'docs/e.ts', 'src/f.css', 'src/a.ts']
  assert.deepEqual(selectSources(files, source), ['apps/web/src/c.tsx', 'src/a.ts', 'src/deep/b.vue'])
  const isExempt = createMatcher(['**/cli/**', 'scripts/**'])
  assert.deepEqual(['src/cli/main.ts', 'cli/main.ts', 'scripts/a.mjs', 'src/client/a.ts'].map(isExempt), [true, true, true, false])
  assert.equal(createMatcher([''])('src/a.ts'), false, '빈 글롭은 아무것도 맞지 않는다')
})

const SMALL_LIMITS = { fileLines: 20, fn: { warn: 6, fail: 10 }, complexity: 4, depth: 2 }
const FIXTURE_VALUES = {
  fileLines: { 'src/orders/service.ts': 27 },
  emptyCatch: { 'src/orders/service.ts': 1 },
  console: { 'src/orders/service.ts': 1 },
  paramsOverLimit: { 'src/orders/format.ts': 1 },
  shortIdentifiers: { 'src/orders/format.ts': 2 },
  historyComments: { 'src/orders/format.ts': 1 },
  missingFileHeader: { 'src/orders/format.ts': 1 },
  fnLines: { 'src/orders/service.ts#sumOrder': 13 },
  complexity: { 'src/orders/service.ts#sumOrder': 5 },
  depth: { 'src/orders/service.ts#sumOrder': 3 },
  componentHooks: {},
  cycles: { 'src/orders/report.ts': 2, 'src/orders/service.ts': 2 },
}

test('가상 프로젝트에서 지표가 손으로 센 값과 같다', async () => {
  const dir = copyFixture()
  writeFiles(dir, { 'lanekit.config.json': structureConfig({ structure: { limits: SMALL_LIMITS } }) })
  const { code, output, outcome } = await runStructure(dir)
  assert.equal(code, 0, 'warn 모드는 찾은 것이 있어도 통과한다')
  assert.equal(outcome.status, 'findings')
  assert.deepEqual(outcome.current, FIXTURE_VALUES)
  assert.deepEqual(
    { files: outcome.metrics.files, functions: outcome.metrics.functions, fnOverWarn: outcome.metrics.fnOverWarn, cycleGroups: outcome.metrics.cycleGroups, findings: outcome.metrics.findings },
    { files: 6, functions: 9, fnOverWarn: 2, cycleGroups: 1, findings: 12 },
  )
  assert.match(output, /structure\s+warn\s+통과\s+파일 6개 · 함수 9개 · 상한을 넘은 것 12건/)
  assert.match(output, /src\/orders\/service\.ts:7 \[fnLines\] 함수 sumOrder 이 13줄이다\. 상한은 10줄이다/)
  assert.match(output, /src\/orders\/service\.ts \[cycles\] 값 import 가 순환한다\. 파일 2개가 한 묶음이다: src\/orders\/report\.ts/)
})

test('fail 모드에서는 찾은 것이 있으면 실패하고, 영어 설정이면 문장이 영어다', async () => {
  const dir = copyFixture()
  writeFiles(dir, { 'lanekit.config.json': { ...structureConfig({ mode: 'fail', structure: { limits: SMALL_LIMITS } }), lang: 'en' } })
  const { code, output } = await runStructure(dir)
  assert.equal(code, 1)
  assert.match(output, /\[fileLines\] 27 lines\. The limit is 20/)
})

test('가독성 지표만 끄면 네 규칙이 값에서 빠진다', async () => {
  const dir = copyFixture()
  writeFiles(dir, { 'lanekit.config.json': structureConfig({ structure: { readable: { enabled: false } } }) })
  const { outcome } = await runStructure(dir)
  assert.deepEqual(Object.keys(outcome.current), ['fileLines', 'emptyCatch', 'console', 'fnLines', 'complexity', 'depth', 'componentHooks', 'cycles'])
})

test('modules 에 ts 가 없으면 건너뛰고 이유를 낸다', async () => {
  const dir = makeProject({ modules: [] }, { 'src/a.ts': 'export const a = 1\n' })
  const { code, outcome } = await runStructure(dir)
  assert.equal(code, 0)
  assert.equal(outcome.status, 'skip')
  assert.equal(outcome.summary, 'modules 에 ts 가 없어서 재지 않는다')
})

test('typescript 가 없는 프로젝트에서는 건너뛰고 이유를 낸다', async () => {
  const dir = makeProject({ modules: ['ts'] }, { 'src/a.ts': 'export const a = 1\n' })
  const { code, output, outcome } = await runStructure(dir)
  assert.equal(code, 0)
  assert.equal(outcome.verdict, 'skip')
  assert.match(outcome.summary, /^typescript 를 찾지 못했다/)
  assert.match(output, /! structure\s+warn\s+건너뜀/)
  assert.equal(outcome.reason, 'check-unverified', '모듈을 켰는데 컴파일러가 없으면 확인하지 못한 것이다')
  assert.equal(locateTypescript(dir), null)
})

test('컴파일러 API 가 없는 typescript 만 있으면 건너뛰고 버전을 알린다', async () => {
  const dir = makeProject({ modules: ['ts'] }, {
    'src/a.ts': 'export const a = 1\n',
    'node_modules/typescript/package.json': { name: 'typescript', version: '9.0.0', main: 'index.js' },
    'node_modules/typescript/index.js': "module.exports = { version: '9.0.0' }\n",
  })
  const { outcome } = await runStructure(dir)
  assert.equal(outcome.status, 'skip')
  assert.match(outcome.summary, /^typescript 9\.0\.0 에는 구문 트리를 만드는 컴파일러 API 가 없다/)
  assert.equal(hasCompilerApi(locateTypescript(dir)), false)
})

test('typescript 는 루트에 없으면 워크스페이스 폴더에서 찾고, typescriptFrom 을 주면 그 폴더에서만 찾는다', () => {
  const fake = { 'package.json': { name: 'typescript', version: '0.0.1', main: 'index.js' }, 'index.js': "module.exports = { version: '0.0.1' }\n" }
  const inWorkspace = (base) => Object.fromEntries(Object.entries(fake).map(([file, content]) => [`${base}/node_modules/typescript/${file}`, content]))
  const npmStyle = makeProject({}, { 'package.json': { workspaces: ['apps/*'] }, ...inWorkspace('apps/web') })
  assert.equal(locateTypescript(npmStyle).version, '0.0.1')
  const pnpmStyle = makeProject({}, { 'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n  - '!packages/skip'\n", ...inWorkspace('packages/core') })
  assert.equal(locateTypescript(pnpmStyle).version, '0.0.1')
  assert.equal(locateTypescript(pnpmStyle, 'packages/none'), null)
  assert.equal(hasCompilerApi(locateTypescript(pnpmStyle, LANEKIT_ROOT)), true)
})

test('설정의 정규식이 틀리면 검사가 오류로 끝나고 게이트는 실패한다', async () => {
  const dir = makeProject(structureConfig({ structure: { readable: { historyPatterns: ['(열린 괄호'] } } }), { 'src/a.ts': '// 머리\nexport const a = 1\n' })
  const { code, outcome } = await runStructure(dir)
  assert.equal(code, 1)
  assert.equal(outcome.status, 'error')
  assert.match(outcome.summary, /^설정의 정규식이 틀렸다: \(열린 괄호/)
})

test('git 이 무시하는 파일은 재지 않는다', async () => {
  const dir = makeProject(structureConfig(), { '.gitignore': '.lanekit/\nsrc/ignored/\n', 'src/a.ts': '// 머리\nexport const a = 1\n', 'src/ignored/b.ts': '// 머리\nexport const b = 1\n' })
  commitAll(dir)
  writeFiles(dir, { 'src/fresh.ts': '// 머리\nexport const fresh = 1\n' })
  const { outcome } = await runStructure(dir)
  assert.equal(outcome.metrics.files, 2, '추적 파일 1개와 새 파일 1개')
})
