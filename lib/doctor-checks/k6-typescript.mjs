// K6 — ts 모듈을 켠 프로젝트에 structure 검사가 쓸 typescript 가 있는지, 쓸 수 있는 버전(5 · 6)인지 본다.
// 부르는 곳: index.mjs.
// 먼저 읽을 파일: ../../kit/checks/structure/typescript.mjs(검사가 컴파일러를 찾는 순서).
import { hasCompilerApi, locateTypescript } from '../../kit/checks/structure/typescript.mjs'
import { readProjectConfig } from '../project-config.mjs'
import { ok, skip, warn } from './result.mjs'

export const SUPPORTED_MAJORS = [5, 6]
const CORE_MODULE = 'ts'
export const meta = { id: 'K6', title: 'doctor.K6.title' }

/** 순수 판정. 컴파일러가 구문 트리 API 를 내고 주 버전이 지원 범위 안인가. */
export function isSupportedCompiler(compiler) {
  const major = Number.parseInt(String(compiler?.version ?? ''), 10)
  return hasCompilerApi(compiler) && SUPPORTED_MAJORS.includes(major)
}

export function check(ctx) {
  const { config } = readProjectConfig(ctx.root)
  if (!config.modules.includes(CORE_MODULE)) return skip(ctx.t('doctor.K6.no-module'))
  const supported = SUPPORTED_MAJORS.join(' · ')
  const compiler = locateTypescript(ctx.root, config.checks.structure.typescriptFrom)
  if (!compiler) return warn(ctx.t('doctor.K6.absent'), ctx.t('doctor.K6.fix', { supported }))
  const version = compiler.version ?? '?'
  if (!isSupportedCompiler(compiler)) return warn(ctx.t('doctor.K6.unsupported', { version, supported }), ctx.t('doctor.K6.fix', { supported }))
  return ok(ctx.t('doctor.K6.ok', { version }))
}
