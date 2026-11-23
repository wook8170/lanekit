// 테스트 도우미 — 임시 가상 프로젝트 만들기, git 저장소로 만들기, 가짜 검사 놓기, 게이트 돌리기.
// 부르는 곳: tests/*.test.mjs.
// 먼저 읽을 파일: ../kit/gate.mjs 의 runGate(테스트가 직접 부르는 함수).
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runGate } from '../kit/gate.mjs'

const TESTS_DIR = dirname(fileURLToPath(import.meta.url))
export const FIXTURE_DIR = join(TESTS_DIR, 'fixtures', 'acme-app')
export const ALL_PROFILES = ['light', 'changed', 'full']

export const makeTempDir = () => mkdtempSync(join(tmpdir(), 'lanekit-test-'))

export const IS_WINDOWS = process.platform === 'win32'
/** 테스트의 skip 옵션에 넣는 값. sh 문법 · 파일 권한 비트 · Windows 가 받지 않는 파일 이름(따옴표 · 탭)이 있어야 하는 테스트에 쓴다. */
export const POSIX_ONLY = IS_WINDOWS ? 'Windows 에서 만들 수 없는 조건(권한 비트 · 따옴표나 탭이 든 파일 이름)을 쓰는 테스트다' : false

export function writeFiles(dir, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, relativePath)), { recursive: true })
    const body = typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`
    writeFileSync(join(dir, relativePath), body)
  }
}

/** 설정 파일과 주어진 파일만 있는 임시 프로젝트. config 는 lanekit.config.json 의 내용이다. */
export function makeProject(config = {}, files = {}) {
  const dir = makeTempDir()
  writeFiles(dir, { 'lanekit.config.json': config, '.gitignore': '.lanekit/\n', ...files })
  return dir
}

/** 가상 프로젝트 acme-app 의 임시 복사본. */
export function copyFixture() {
  const dir = makeTempDir()
  cpSync(FIXTURE_DIR, dir, { recursive: true })
  writeFiles(dir, { '.gitignore': '.lanekit/\n' })
  return dir
}

export function git(dir, ...args) {
  const isolated = ['-c', 'user.name=acme', '-c', 'user.email=dev@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null']
  return execFileSync('git', [...isolated, ...args], { cwd: dir, encoding: 'utf8' }).trim()
}

/** 폴더를 git 저장소로 만들고 지금 파일을 모두 커밋한다. 커밋 해시를 돌려준다. */
export function commitAll(dir, message = 'init') {
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', message)
  return git(dir, 'rev-parse', 'HEAD')
}

// 가짜 검사는 받은 ctx 의 일부를 자기 옆의 seen.json 에 적어, 테스트가 실행기가 넘긴 값을 볼 수 있게 한다.
const stubSource = (meta) => `import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
export const meta = ${JSON.stringify(meta)}
export async function run(ctx) {
  const seen = { evidencePath: ctx.evidencePath, profile: ctx.profile, baseline: ctx.baseline, mode: ctx.mode, changedFiles: ctx.changedFiles, relock: ctx.relock }
  writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'seen.json'), JSON.stringify(seen))
  const planned = JSON.parse(readFileSync(join(ctx.root, 'stub-' + meta.id + '.json'), 'utf8'))
  if (planned.throws) throw new Error(planned.throws)
  return planned
}
`

/**
 * 가짜 검사를 프로젝트 밖 임시 폴더에 놓고 등록표 한 줄({ id, file })에 seenFile 을 붙여 돌려준다.
 * 가짜 검사는 프로젝트의 stub-<id>.json 을 읽어 그대로 돌려준다. 그래서 테스트가 결과를 바꿔 가며 돌릴 수 있다.
 */
export function stubCheck(id, metaOverrides = {}) {
  const meta = { id, profiles: ALL_PROFILES, defaultMode: 'warn', ratchetable: true, ...metaOverrides }
  const dir = makeTempDir()
  const file = join(dir, `${id}.mjs`)
  writeFileSync(file, stubSource(meta))
  return { id, file, seenFile: join(dir, 'seen.json') }
}

/** 가짜 검사가 다음에 돌려줄 결과를 정한다. */
export function planStubResult(dir, id, result) {
  writeFiles(dir, { [`stub-${id}.json`]: { summary: 'stub', findings: [], metrics: {}, ...result } })
}

export const finding = (file, rule = 'rule-a') => ({ file, line: 1, rule, message: 'stub finding', value: 1, limit: 0 })

/** 게이트를 돌려 { code, output } 을 돌려준다. registry 를 주지 않으면 실제 등록표를 쓴다. */
export async function gate(cwd, argv, registry) {
  let output = ''
  const code = await runGate({ argv, cwd, registry, write: (text) => { output += text } })
  return { code, output }
}

export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
