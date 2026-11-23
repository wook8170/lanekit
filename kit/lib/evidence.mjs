// 증거 파일 — 게이트를 한 번 돌린 기록을 .lanekit/evidence/ 에 JSON 으로 남긴다.
// 부르는 곳: gate.mjs(검사를 모두 돌린 뒤). 읽는 쪽은 출하 관문과 provenance 검사다.
// 먼저 읽을 파일: gate.mjs 의 runProfile(넘겨받는 값이 만들어지는 곳).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isBlockedPath, writeInside } from './safe-write.mjs'

export const EVIDENCE_SCHEMA = 'lanekit-evidence/1'
const EVIDENCE_DIR = '.lanekit/evidence'
export const evidenceDir = (root) => join(root, EVIDENCE_DIR)

/** 증거 파일 경로(루트 기준). --only · --skip 으로 일부만 돌린 기록은 -partial 을 붙여, 온전한 기록을 덮어쓰지 않게 한다. */
const evidenceRelativePath = ({ commit, profile, partial }) => `${EVIDENCE_DIR}/${commit.slice(0, 12)}-${profile}${partial ? '-partial' : ''}.json`

export function evidencePath(root, run) {
  return join(root, evidenceRelativePath(run))
}

// 찾은 것의 본문은 싣지 않고 건수만 싣는다. 비밀값이나 금지어가 증거 파일에 남지 않게 하기 위해서다.
function checkRecord(outcome) {
  return {
    id: outcome.id,
    mode: outcome.mode,
    status: outcome.status,
    verdict: outcome.verdict,
    reason: outcome.reason,
    summary: outcome.summary,
    metrics: outcome.metrics,
    findingCount: outcome.findings.length,
    durationMs: outcome.durationMs,
  }
}

/** 순수 함수. 실행 정보(run) · 검사별 결과 · 증거 뒤에 도는 검사 ID 를 증거 파일의 모양으로 바꾼다. */
export function buildEvidence(run, outcomes, deferred) {
  const executed = outcomes.filter((outcome) => outcome.action === 'run')
  const skipped = outcomes.filter((outcome) => outcome.action === 'skip')
  return {
    schema: EVIDENCE_SCHEMA,
    commit: run.commit,
    dirty: run.dirty,
    profile: run.profile,
    partial: run.partial,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    node: process.version,
    lanekit: run.lanekitVersion,
    failed: executed.filter((outcome) => outcome.verdict === 'fail').map((outcome) => outcome.id),
    checks: executed.map(checkRecord),
    skipped: skipped.map((outcome) => ({ id: outcome.id, mode: outcome.mode, reason: outcome.reason })),
    deferred,
  }
}

/** 증거 파일을 쓸 수 없으면 그 경로(루트 기준), 쓸 수 있으면 null. 검사를 돌리기 전에 확인해, 다 돌린 뒤에 쓰지 못하는 일을 막는다. */
export function blockedEvidencePath(root, run) {
  const path = evidenceRelativePath(run)
  return isBlockedPath(root, path) ? path : null
}

/** 증거 파일을 쓰고 그 경로를 돌려준다. 저장소 안에만 쓴다. 쓸 자리가 링크면 BlockedPathError 다. */
export function writeEvidence(root, evidence) {
  writeInside(root, evidenceRelativePath(evidence), `${JSON.stringify(evidence, null, 2)}\n`)
  return evidencePath(root, evidence)
}

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null)

/** lanekit 버전. 프로젝트의 복사본이면 잠금 파일에서, 원본 저장소면 package.json 에서 읽는다. */
export function readLanekitVersion(root, kitDir) {
  const lock = readJson(join(root, 'scripts', 'lanekit', 'lanekit.lock.json'))
  if (lock?.version) return lock.version
  const origin = readJson(join(kitDir, '..', 'package.json'))
  return origin?.name === 'lanekit' ? origin.version : 'unknown'
}
