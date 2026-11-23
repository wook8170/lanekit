// SBOM 검사(sbom) — 의존성 명세(CycloneDX)를 만들어 .lanekit/sbom/ 에 쓴다. 만들 수 없으면 찾은 것으로 알린다.
// 부르는 곳: gate.mjs(등록표의 sbom. full 프로필에서만 돈다). 쓴 파일은 provenance.mjs 가 해시한다.
// 먼저 읽을 파일: provenance.mjs(이 파일의 경로 함수를 쓰는 곳).
import { join, relative } from 'node:path'
import { findExecutable, runShell, runTool } from '../../lib/exec.mjs'
import { writeInside } from '../../lib/safe-write.mjs'
import { toPosixPath } from '../../lib/platform.mjs'

export const meta = {
  id: 'sbom',
  profiles: ['full'],
  defaultMode: 'warn',
  ratchetable: false,
}

const SHORT_COMMIT = 12
const NO_COMMIT = 'no-git'

/** SBOM 파일의 경로. 커밋이 없으면 `no-git` 을 이름에 쓴다. */
export function sbomPath(root, commit) {
  return join(root, '.lanekit', 'sbom', `${(commit ?? NO_COMMIT).slice(0, SHORT_COMMIT)}.cdx.json`)
}

function generate(root, command) {
  if (command) return runShell(command, { cwd: root })
  const npmFile = findExecutable('npm')
  if (!npmFile) return { code: null, stdout: '', stderr: '', startError: 'npm not found' }
  return runTool(npmFile, ['sbom', '--sbom-format', 'cyclonedx'], { cwd: root })
}

/** 순수 함수. 명령의 출력이 쓸 수 있는 SBOM 인지 본다. 돌려주는 값은 { components } 나 { problem } 이다. */
export function readSbomOutput(outcome) {
  if (outcome.code !== 0) return { problem: `exit ${outcome.code ?? outcome.startError} ${outcome.stderr.trim().split('\n').at(-1) ?? ''}`.trim() }
  try {
    const document = JSON.parse(outcome.stdout)
    return { components: Array.isArray(document.components) ? document.components.length : 0 }
  } catch (error) {
    if (error instanceof SyntaxError) return { problem: 'not-json' }
    throw error
  }
}

/** 검사 계약의 run. */
export async function run(ctx) {
  const outcome = generate(ctx.root, ctx.config.checks.sbom.command)
  const read = readSbomOutput(outcome)
  if (read.problem) {
    const finding = { file: 'sbom', line: null, rule: 'sbom-failed', message: ctx.t('sbom.failed', { detail: read.problem }), value: 1, limit: 0 }
    return { status: 'findings', summary: ctx.t('sbom.failed', { detail: read.problem }), findings: [finding], metrics: { written: 0 }, current: null }
  }
  const file = sbomPath(ctx.root, ctx.git.head())
  writeInside(ctx.root, relative(ctx.root, file), outcome.stdout)
  return {
    status: 'pass',
    summary: ctx.t('sbom.written', { file: toPosixPath(relative(ctx.root, file)), components: read.components }),
    findings: [],
    metrics: { written: 1, components: read.components, bytes: Buffer.byteLength(outcome.stdout) },
    current: null,
  }
}
