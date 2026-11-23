// 검사 하나 실행 — 검사에 넘길 ctx 를 만들고, 돌리고, 반환값을 계약의 모양으로 맞춘다. 판정은 하지 않는다.
// 부르는 곳: gate.mjs(프로필 실행과 재잠금).
// 먼저 읽을 파일: checks/guidance/run.mjs(검사 쪽에서 본 같은 계약).
import { relative } from 'node:path'
import { ConfigError } from './config.mjs'
import { createKitTranslator } from './messages.mjs'
import { toPosixPath } from './platform.mjs'

const STATUSES = ['pass', 'findings', 'skip', 'error']

const errorResult = (summary) => ({ status: 'error', summary, findings: [], metrics: {}, current: null, relockValues: null, unverified: false })

/**
 * 검사가 돌려준 값을 계약의 칸으로 맞춘다. status 가 계약 밖이면 오류 결과로 바꾼다.
 * unverified 는 건너뛴 이유가 「볼 것이 없다」가 아니라 「도구가 없거나 결과를 얻지 못해 확인하지 못했다」일 때 참이다.
 */
export function normalizeResult(raw) {
  if (!raw || !STATUSES.includes(raw.status)) return errorResult(`bad-result: status=${raw?.status}`)
  return {
    status: raw.status,
    summary: String(raw.summary ?? ''),
    findings: Array.isArray(raw.findings) ? raw.findings : [],
    metrics: raw.metrics ?? {},
    current: raw.current ?? null,
    relockValues: raw.relockValues ?? null,
    unverified: raw.status === 'skip' && Boolean(raw.unverified),
  }
}

function buildContext(step, session, run) {
  return {
    root: session.root,
    config: session.config,
    mode: step.mode,
    profile: run.profile,
    changedFiles: run.changedFiles,
    baseline: run.baseline?.values ?? null,
    git: session.git,
    t: createKitTranslator(session.config.lang, [step.check.messagesDir]),
    modules: session.modules,
    evidencePath: run.evidencePath ?? null,
    relock: Boolean(run.relock),
  }
}

/** 검사를 돌려 { ...결과, durationMs } 를 돌려준다. 검사가 던진 예외는 오류 결과가 된다. ConfigError 만 그대로 던진다. */
export async function runCheck(step, session, run) {
  const startedAt = performance.now()
  let result
  if (!step.check.installed) {
    result = errorResult(session.t('check.not-installed', { file: toPosixPath(relative(session.root, step.check.file)) }))
  } else {
    try {
      result = normalizeResult(await step.check.run(buildContext(step, session, run)))
    } catch (error) {
      // 검사가 알린 설정 오류는 실패가 아니라 설정 오류(종료 코드 2)로 끝나야 한다. 그래서 게이트까지 올려 보낸다.
      if (error instanceof ConfigError) throw error
      result = errorResult(`${error.name}: ${error.message}`)
    }
  }
  return { ...result, durationMs: Math.round(performance.now() - startedAt) }
}
