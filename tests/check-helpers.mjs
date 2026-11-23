// 검사 테스트 도우미 — 검사의 run 을 실행기 없이 부르기, 가짜 실행 파일 놓기, 환경 변수를 잠깐 바꾸기.
// 부르는 곳: 검사마다 있는 tests/<검사>.test.mjs.
// 먼저 읽을 파일: helpers.mjs(임시 프로젝트 만들기), ../kit/lib/runner.mjs(실제 ctx 가 만들어지는 곳).
import { chmodSync, symlinkSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateConfig } from '../kit/lib/config.mjs'
import { createGit } from '../kit/lib/git.mjs'
import { findExecutable } from '../kit/lib/exec.mjs'
import { createKitTranslator } from '../kit/lib/messages.mjs'
import { IS_WINDOWS, makeTempDir, readJson } from './helpers.mjs'

const CHECKS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'kit', 'checks')

/** 검사의 run 을 실행기가 넘기는 것과 같은 모양의 ctx 로 부른다. folder 는 kit/checks 아래의 폴더 이름이다. */
export function callCheck(run, folder, root, overrides = {}) {
  const { config, problems } = validateConfig(readJson(join(root, 'lanekit.config.json')))
  if (problems.length > 0) throw new Error(`bad test config: ${JSON.stringify(problems)}`)
  return run({
    root,
    config,
    mode: 'warn',
    profile: 'light',
    changedFiles: null,
    baseline: null,
    git: createGit(root),
    t: createKitTranslator(config.lang, [join(CHECKS_DIR, folder)]),
    modules: {},
    evidencePath: null,
    ...overrides,
  })
}

/**
 * 가짜 실행 파일을 임시 폴더에 놓고 그 폴더를 돌려준다. body 는 Node 스크립트의 본문이다.
 * Windows 는 첫 줄(#!)로 실행할 프로그램을 고르지 못한다. 그래서 같은 이름의 배치 파일을 옆에 두어 node 로 그 스크립트를 돌린다.
 */
export function fakeTool(name, body) {
  const dir = makeTempDir()
  const file = join(dir, name)
  writeFileSync(file, `#!/usr/bin/env node\n${body}\n`)
  chmodSync(file, 0o755)
  if (IS_WINDOWS) writeFileSync(join(dir, `${name}.cmd`), `@node "%~dp0${name}" %*\r\n`)
  return dir
}

/** 환경 변수를 바꾼 채로 action 을 돌리고 원래 값으로 되돌린다. 값이 undefined 면 그 변수를 지운다. */
export async function withEnv(changes, action) {
  const before = Object.fromEntries(Object.keys(changes).map((key) => [key, process.env[key]]))
  const apply = (values) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  apply(changes)
  try {
    return await action()
  } finally {
    apply(before)
  }
}

/** toolDir 을 PATH 맨 앞에 두고 action 을 돌린다. */
export const withToolFirst = (toolDir, action) => withEnv({ PATH: `${toolDir}${delimiter}${process.env.PATH}` }, action)

// 기본 명령(git 포함)이 있는 폴더. Windows 에는 정해진 폴더가 없어서 git 이 깔린 폴더를 찾아 쓴다.
const BASIC_COMMAND_DIRS = IS_WINDOWS ? [dirname(findExecutable('git') ?? '')].filter((dir) => dir !== '.') : ['/usr/bin', '/bin']

// node 실행 파일만 든 폴더. node 가 깔린 폴더에는 npm · pnpm 도 함께 있어 그 폴더를 PATH 에 그대로 둘 수 없다.
let nodeOnlyDir = null
function findNodeOnlyDir() {
  if (nodeOnlyDir === null) {
    nodeOnlyDir = makeTempDir()
    symlinkSync(process.execPath, join(nodeOnlyDir, IS_WINDOWS ? 'node.exe' : 'node'))
  }
  return nodeOnlyDir
}

/** node 와 기본 명령만 있는 PATH 로 action 을 돌린다. 머신에 깔린 도구(gitleaks · npm · pnpm)를 검사가 찾지 못하게 한다. extraDirs 를 앞에 둔다. */
export function withBarePath(extraDirs, action) {
  return withEnv({ PATH: [...extraDirs, findNodeOnlyDir(), ...BASIC_COMMAND_DIRS].join(delimiter) }, action)
}

export const rulesOf = (result) => result.findings.map((found) => found.rule)
