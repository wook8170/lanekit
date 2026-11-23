// 모드별 판정 — 검사가 알린 결과를 모드 규칙에 견주어 통과 · 실패를 정한다. 판정 규칙은 이 파일에만 있다.
// 부르는 곳: gate.mjs(검사 하나를 돌린 직후).
// 먼저 읽을 파일: baseline.mjs(ratchet 모드가 쓰는 비교).
import { compareValues, isUnusableLock, strictestValues, unloggedIncreases } from './baseline.mjs'

/** 검사가 도구가 없거나 결과를 얻지 못해 건너뛴 경우의 판정 사유. 프로필과 상관없이 실패가 아니라 경고다. 증거 파일에 이 사유가 남는다. */
export const UNVERIFIED_REASON = 'check-unverified'

const hasFindings = (result) => result.status === 'findings' || result.findings.length > 0

// 기준선 파일은 재잠금 이력과 함께 읽는다. 이력에 없는 증가가 기준선에 있으면, 지금 값이 그 안에 들어도 실패다.
// 지금 값은 기준선과 이력 가운데 칸마다 더 작은 쪽과 견준다. 기준선에서 규칙이나 칸을 지워도 이력의 값이 상한으로 남는다.
function judgeRatchet(result, baseline, logged) {
  if (!result.current) return { verdict: 'fail', reason: 'current-missing' }
  if (isUnusableLock(logged)) return { verdict: 'fail', reason: 'log-without-values' }
  const unlogged = unloggedIncreases(baseline.values, logged)
  if (unlogged.length > 0) return { verdict: 'fail', reason: 'baseline-unlogged', increases: unlogged, newRules: [] }
  const { increases, newRules } = compareValues(result.current, strictestValues(baseline.values, logged?.values ?? null))
  if (increases.length > 0) return { verdict: 'fail', reason: 'ratchet-increase', increases, newRules }
  return { verdict: 'pass', reason: 'within-baseline', increases, newRules }
}

/**
 * 순수 판정. mode 는 warn · ratchet · fail 가운데 하나다(off 는 계획 단계에서 건너뛴다).
 * 검사가 오류로 끝나면 모드와 상관없이 실패다. 조용히 통과하는 일을 막기 위해서다.
 * 검사가 스스로 건너뛰면 실패가 아니다. 확인하지 못해 건너뛴 것(unverified)은 사유를 따로 남겨 경고로 보이게 한다.
 * logged 는 재잠금 이력에 남은 그 검사의 마지막 잠금이다(baseline.mjs 의 readLoggedLock). ratchet 모드에서만 쓴다.
 */
export function judge({ mode, result, baseline, logged = null }) {
  if (result.status === 'error') return { verdict: 'fail', reason: 'check-error' }
  if (result.status === 'skip') return { verdict: 'skip', reason: result.unverified ? UNVERIFIED_REASON : 'check-skipped' }
  if (mode === 'ratchet') return judgeRatchet(result, baseline, logged)
  if (mode === 'fail' && hasFindings(result)) return { verdict: 'fail', reason: 'findings' }
  if (hasFindings(result)) return { verdict: 'pass', reason: 'warn-only' }
  return { verdict: 'pass', reason: 'clean' }
}

/** 실행 전에 걸러야 하는 설정 문제. ratchet 모드인데 기준선을 쓸 수 없는 검사를 찾는다. */
export function ratchetProblems(steps, baselines) {
  return steps
    .filter((step) => step.action === 'run' && step.mode === 'ratchet' && step.check.installed)
    .flatMap((step) => {
      const path = `checks.${step.id}.mode`
      if (!step.check.meta.ratchetable) return [{ path, code: 'not-ratchetable' }]
      if (!baselines[step.id]) return [{ path, code: 'baseline-missing', got: step.id }]
      return []
    })
}
