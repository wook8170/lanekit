// 저장소 감지 — 패키지 관리자 · 스택 · 문서 폴더 · 원격 종류를 읽어 init 질문의 기본값을 정한다.
// 부르는 곳: init.mjs(질문 전에 한 번).
// 먼저 읽을 파일: init-plan.mjs(감지 결과와 답을 합치는 곳).
import { existsSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { isPlainObject, readJsonOr } from './json-file.mjs'

const LOCK_FILES = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['package-lock.json', 'npm'],
  ['yarn.lock', 'yarn'],
]
const DOCS_DIRS = ['docs', 'doc', 'documentation']
const UI_PACKAGES = ['react', 'vue', 'svelte', 'next', 'nuxt', '@angular/core', 'solid-js']
const SERVICE_PACKAGES = ['fastify', 'express', 'koa', 'hono', '@nestjs/core']
const RELATED_TESTS = { vitest: 'vitest related --run {files}', jest: 'jest --findRelatedTests {files}' }
const EXEC_PREFIX = { pnpm: 'pnpm exec ', npm: 'npx ', yarn: 'yarn ' }

const isDirectory = (path) => existsSync(path) && statSync(path).isDirectory()

function dependencyNames(packageJson) {
  return Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies })
}

/** 순수 판정. 의존성으로 프로젝트 종류를 고른다. */
export function guessKind(packageJson, dependencies) {
  if (dependencies.some((name) => UI_PACKAGES.includes(name))) return 'web-ui'
  if (dependencies.some((name) => SERVICE_PACKAGES.includes(name))) return 'service'
  if (packageJson.main || packageJson.exports) return 'library'
  return 'other'
}

/** 순수 판정. 원격 주소로 원격 관문의 기본값을 고른다. 모르는 호스트는 git 훅만 쓴다. */
export function guessRemoteGate(remoteUrl) {
  if (/github\.com[:/]/i.test(remoteUrl)) return 'github'
  if (/gitlab/i.test(remoteUrl)) return 'gitlab'
  return 'git-hook'
}

/** 순수 판정. 전체 테스트 명령과 바뀐 파일만 돌리는 명령의 기본값. 알 수 없으면 빈 문자열이다. */
export function guessTestCommands(packageJson, dependencies, packageManager) {
  const manager = packageManager ?? 'npm'
  const runner = Object.keys(RELATED_TESTS).find((name) => dependencies.includes(name))
  return {
    full: packageJson.scripts?.test ? `${manager} test` : '',
    changed: runner ? `${EXEC_PREFIX[manager]}${RELATED_TESTS[runner]}` : '',
  }
}

/** 순수 판정. 켜기를 권할 스택 모듈. fastify 가 있으면 ts 와 함께 권한다. */
export function guessModules(dependencies) {
  if (!dependencies.includes('typescript')) return []
  return dependencies.includes('fastify') ? ['ts', 'ts-fastify'] : ['ts']
}

/** 저장소를 읽어 감지 결과를 돌려준다. run 은 git 원격 주소를 읽는 데만 쓴다. */
export function detectProject(root, run) {
  const rawPackage = readJsonOr(join(root, 'package.json'), {})
  const packageJson = isPlainObject(rawPackage) ? rawPackage : {}
  const dependencies = dependencyNames(packageJson)
  const packageManager = LOCK_FILES.find(([file]) => existsSync(join(root, file)))?.[1] ?? null
  const remote = run('git', ['-C', root, 'remote', 'get-url', 'origin'])
  return {
    projectName: typeof packageJson.name === 'string' && packageJson.name ? packageJson.name : basename(root),
    packageManager,
    kind: guessKind(packageJson, dependencies),
    modules: guessModules(dependencies),
    tests: guessTestCommands(packageJson, dependencies, packageManager),
    docsDir: DOCS_DIRS.find((name) => isDirectory(join(root, name))) ?? null,
    remoteGate: guessRemoteGate(remote.code === 0 ? remote.stdout.trim() : ''),
  }
}
