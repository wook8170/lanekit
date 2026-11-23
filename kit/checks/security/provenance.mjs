// 출처 문서 검사(provenance) — 「어떻게 만들었는지」를 적은 문서를 .lanekit/evidence/ 에 쓴다. 증거 파일을 쓴 뒤에 돈다.
// 부르는 곳: gate.mjs(등록표의 provenance. full 프로필에서만, 증거 파일 뒤에 돈다).
// 먼저 읽을 파일: ../../lib/evidence.mjs(해시할 증거 파일의 모양), sbom.mjs(해시할 SBOM 의 위치).
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { writeInside } from '../../lib/safe-write.mjs'
import { sbomPath } from './sbom.mjs'
import { toPosixPath } from '../../lib/platform.mjs'

export const meta = {
  id: 'provenance',
  profiles: ['full'],
  defaultMode: 'warn',
  ratchetable: false,
  afterEvidence: true,
}

export const PROVENANCE_SCHEMA = 'lanekit-provenance/1'
const SHORT_COMMIT = 12

/** 저장소 주소에서 인증 정보(`사용자:토큰@`)를 지운다. `git@host:경로` 꼴은 인증 정보가 아니라 그대로 둔다. */
export function stripCredentials(url) {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]+@/i, '$1')
}

const sha256Of = (file) => `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`
const describeFile = (root, file) => ({ file: toPosixPath(relative(root, file)), sha256: sha256Of(file) })

function readRepository(git) {
  const url = git.tryRun(['config', '--get', 'remote.origin.url'])
  return url ? stripCredentials(url) : null
}

/** 출처 문서의 내용을 모은다. 증거 파일은 반드시 있어야 하고, SBOM 은 없으면 null 로 둔다. */
function buildProvenance(ctx, evidence) {
  const sbomFile = sbomPath(ctx.root, evidence.commit)
  return {
    schema: PROVENANCE_SCHEMA,
    createdAt: new Date().toISOString(),
    commit: evidence.commit,
    dirty: evidence.dirty,
    tags: (ctx.git.tryRun(['tag', '--points-at', 'HEAD']) ?? '').split('\n').filter(Boolean),
    repository: readRepository(ctx.git),
    build: { command: ctx.config.build.command },
    tools: { node: process.version, lanekit: evidence.lanekit, git: ctx.git.tryRun(['--version']) },
    evidence: { ...describeFile(ctx.root, ctx.evidencePath), profile: evidence.profile, partial: evidence.partial },
    sbom: existsSync(sbomFile) ? describeFile(ctx.root, sbomFile) : null,
  }
}

/** 순수 판정. 출처 문서가 출하 근거로 약해지는 까닭을 규칙 이름으로 돌려준다. */
export function findWeakPoints(provenance) {
  return [
    provenance.evidence.partial ? 'evidence-partial' : null,
    provenance.dirty ? 'evidence-dirty' : null,
    provenance.sbom === null ? 'sbom-missing' : null,
  ].filter(Boolean)
}

/** 검사 계약의 run. 증거 파일이 없으면(--no-evidence) 문서를 쓰지 않고 찾은 것으로 알린다. */
export async function run(ctx) {
  const toFinding = (rule) => ({ file: 'provenance', line: null, rule, message: ctx.t(`provenance.${rule}`), value: 1, limit: 0 })
  if (!ctx.evidencePath || !existsSync(ctx.evidencePath)) {
    return { status: 'findings', summary: ctx.t('provenance.evidence-missing'), findings: [toFinding('evidence-missing')], metrics: { written: 0 }, current: null }
  }
  const evidence = JSON.parse(readFileSync(ctx.evidencePath, 'utf8'))
  const provenance = buildProvenance(ctx, evidence)
  // 일부만 돌린 실행의 출처 문서는 따로 둔다. 같은 커밋의 온전한 실행에서 만든 문서를 덮어쓰지 않게 하기 위해서다.
  const file = join(dirname(ctx.evidencePath), `${evidence.commit.slice(0, SHORT_COMMIT)}-provenance${evidence.partial ? '-partial' : ''}.json`)
  writeInside(ctx.root, relative(ctx.root, file), `${JSON.stringify(provenance, null, 2)}\n`)
  const weakPoints = findWeakPoints(provenance)
  return {
    status: weakPoints.length > 0 ? 'findings' : 'pass',
    summary: ctx.t('provenance.written', { file: toPosixPath(relative(ctx.root, file)) }),
    findings: weakPoints.map(toFinding),
    metrics: { written: 1, hasSbom: provenance.sbom ? 1 : 0 },
    current: null,
  }
}
