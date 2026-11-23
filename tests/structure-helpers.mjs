// 구조 검사 테스트 도우미 — 컴파일러 묶기, 소스 글 만들기, 메모리 안에서 재고 판정하기, 게이트로 돌리기.
// 부르는 곳: tests/structure-*.test.mjs.
// 먼저 읽을 파일: helpers.mjs(임시 프로젝트와 게이트 도우미), ../kit/checks/structure/run.mjs(같은 순서를 따른다).
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { measureSource } from '../kit/checks/structure/measure.mjs'
import { judgeStructure } from '../kit/checks/structure/ratchet.mjs'
import { compileReadableRules } from '../kit/checks/structure/readable.mjs'
import { fitToBaseline } from '../kit/checks/structure/relock.mjs'
import { bindTypescript, locateTypescript } from '../kit/checks/structure/typescript.mjs'
import { compareValues } from '../kit/lib/baseline.mjs'
import { validateConfig } from '../kit/lib/config.mjs'
import { gate, makeTempDir, readJson } from './helpers.mjs'

/** lanekit 저장소의 루트. 개발 의존으로 설치한 typescript 가 여기에 있다. */
export const LANEKIT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** 저장소의 typescript 를 측정 코드에 묶고 돌려준다. measureSource 를 직접 부르는 테스트가 먼저 부른다. */
export function useTypescript() {
  const compiler = locateTypescript(LANEKIT_ROOT)
  bindTypescript(compiler)
  return compiler
}

/** 기본값이 채워진 structure 설정. overrides 는 checks.structure 에 겹친다. */
export function structureOptions(overrides = {}) {
  const { config, problems } = validateConfig({ modules: ['ts'], checks: { structure: overrides } })
  if (problems.length > 0) throw new Error(JSON.stringify(problems))
  return config.checks.structure
}

/** 기본 설정의 읽기 쉬운 코드 규칙. */
export const defaultReadable = (overrides = {}) => compileReadableRules(structureOptions({ readable: overrides }).readable)

/** 줄이 lineCount 개인 본문을 가진 함수의 소스. 함수 전체는 lineCount + 2 줄이다. */
export function fnSource(name, lineCount) {
  const body = Array.from({ length: lineCount }, (unused, index) => `  const value${index} = ${index}`).join('\n')
  return `export function ${name}() {\n${body}\n}\n`
}

/** 선언만 lineCount 줄 있는 소스. */
export const constLines = (lineCount) => Array.from({ length: lineCount }, (unused, index) => `export const value${index} = ${index}`).join('\n')

export const byKey = (measurement) => Object.fromEntries(measurement.functions.map((fn) => [fn.key, fn]))

/**
 * 파일 글 묶음 { 경로: 글 } 을 재서 상한을 넘은 값으로 바꾼다. 기본 상한을 쓰고 읽기 쉬운 코드 지표도 잰다.
 * routeFiles 에 든 경로는 routeRules 로 잰다.
 */
export function valuesOf(files, { routeRules = null, routeFiles = [], isServerTop = () => false } = {}) {
  const options = structureOptions()
  const readable = compileReadableRules(options.readable)
  const measured = Object.fromEntries(
    Object.entries(files).map(([file, text]) => [file, measureSource(file, text, { readable, routeRules: routeFiles.includes(file) ? routeRules : null })]),
  )
  const settings = {
    limits: { ...options.limits, route: routeRules ? options.routes.route : options.limits.fn, routesPerFile: options.routes.routesPerFile },
    isReadableOn: true,
    isRoutesOn: routeRules !== null,
    isConsoleExempt: () => false,
    isServerTop,
  }
  return judgeStructure(measured, settings).values
}

/** 실행기와 같은 순서로 견준다: 기준선에 맞춰 다듬은 뒤 칸마다 비교한다. 늘어난 칸의 「규칙 키」 목록을 돌려준다. */
export function increasesAgainst(values, baseline, moves = []) {
  const fitted = fitToBaseline(values, baseline, structureOptions().slack)
  const { increases, newRules } = compareValues(fitted.current, baseline, moves)
  return { ...fitted, newRules, increases, increased: increases.map((increase) => `${increase.rule} ${increase.key}`) }
}

/** structure 검사가 도는 설정. typescript 는 lanekit 저장소의 것을 쓴다. */
export function structureConfig({ modules = ['ts'], mode = 'warn', structure = {} } = {}) {
  return { modules, checks: { structure: { mode, typescriptFrom: LANEKIT_ROOT, ...structure } } }
}

/** 게이트로 structure 만 돌리고 { code, output, outcome } 을 돌려준다. outcome 은 --json 결과의 structure 칸이다. */
export async function runStructure(dir, argv = []) {
  const jsonFile = join(makeTempDir(), 'result.json')
  const { code, output } = await gate(dir, ['--only', 'structure', '--no-evidence', '--json', jsonFile, ...argv])
  const outcome = code === 2 ? null : readJson(jsonFile).outcomes.find((entry) => entry.id === 'structure')
  return { code, output, outcome }
}

/** no-reply-thenable 규칙의 견본 소스. `// hit` 로 끝나는 줄이 규칙에 걸려야 하는 줄이다. */
export const REPLY_SOURCE = `interface FastifyReply {
  then(resolve: () => void, reject: (error: unknown) => void): void
  code(status: number): FastifyReply
  send(body?: unknown): FastifyReply
}
declare const reply: FastifyReply
declare function isAllowed(): boolean

async function guard(): Promise<boolean> {
  if (!isAllowed()) {
    reply.code(403).send()
    return true
  }
  return false
}
async function replyGate() {
  if (!isAllowed()) return reply.code(403).send()
  return null
}
async function fallsThrough() {
  if (!isAllowed()) return reply.send()
}
async function alwaysReplies() {
  return reply.send()
}
async function handler() {
  const rejected = await replyGate() // hit
  if (await replyGate()) return // hit
  if (await fallsThrough()) return // hit
  await reply.send()
  const sent = await reply.send() // hit
  if (await guard()) return
  const done = await alwaysReplies()
  void (await replyGate())
  return await replyGate()
}
reply.send().then(() => {}) // hit
replyGate().catch(() => {}) // hit
Promise.all([guard(), replyGate()]) // hit
Promise.all([guard()])
const forward = async () => await replyGate()
`
