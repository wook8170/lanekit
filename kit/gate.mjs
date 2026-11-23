#!/usr/bin/env node
// 게이트 실행기 — 설정을 읽고, 프로필에 맞는 검사를 돌리고, 모드 규칙으로 판정하고, 증거 파일을 남긴다.
// 부르는 곳: 프로젝트의 `node scripts/lanekit/gate.mjs`, pre-push 훅, CI. 테스트는 runGate 를 직접 부른다.
// 먼저 읽을 파일: lib/profile.mjs(무엇을 돌리나) → lib/verdict.mjs(어떻게 판정하나) → checks/guidance/run.mjs(검사 견본).
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseGateArgs, UsageError } from './lib/args.mjs'
import { applyRelock, blockedRelockPaths, hasDecisionFile, planRelock, readBaseline, readLoggedLock, readMoves, sumByRule } from './lib/baseline.mjs'
import { CONFIG_FILE, ConfigError, effectiveMode, findRoot, loadConfig } from './lib/config.mjs'
import { blockedEvidencePath, buildEvidence, readLanekitVersion, writeEvidence } from './lib/evidence.mjs'
import { createGit } from './lib/git.mjs'
import { createKitTranslator } from './lib/messages.mjs'
import { isEntryScript, toPosixPath } from './lib/platform.mjs'
import { planChecks, unknownIds } from './lib/profile.mjs'
import { defaultRegistry, findModuleDirs, loadChecks } from './lib/registry.mjs'
import { formatList, formatProblems, formatRelock, formatRun, formatUsage } from './lib/report.mjs'
import { runCheck } from './lib/runner.mjs'
import { BlockedPathError } from './lib/safe-write.mjs'
import { judge, ratchetProblems } from './lib/verdict.mjs'

const KIT_DIR = dirname(fileURLToPath(import.meta.url))
const NO_COMMIT = 'no-git'

/** 설정 · 검사 · git 을 읽어 한 번의 실행이 쓰는 값을 모은다. 설정이 틀리면 ConfigError 다. */
async function openSession(cwd, registry) {
  const root = findRoot(cwd)
  if (!root) throw new ConfigError([{ path: CONFIG_FILE, code: 'config-not-found' }])
  const config = loadConfig(root)
  return {
    cwd,
    root,
    config,
    checks: await loadChecks(registry ?? defaultRegistry(KIT_DIR)),
    modules: findModuleDirs(KIT_DIR, config.modules),
    git: createGit(root),
    t: createKitTranslator(config.lang),
  }
}

function readBaselines(root, steps) {
  const ratchetable = steps.filter((step) => step.check.installed && step.check.meta.ratchetable)
  return Object.fromEntries(ratchetable.map((step) => [step.id, readBaseline(root, step.id)]))
}

const RELEASE_PROFILE = 'full'

/**
 * 순수 판정. 출하 프로필(full)을 커밋하지 않은 변경이 있는 채로 돌렸는가.
 * 그런 실행은 검사한 내용이 커밋과 다를 수 있어 출하 근거가 되지 못한다. 그래서 검사가 모두 통과해도 실패로 끝낸다.
 */
export function isDirtyRelease(run) {
  return run.profile === RELEASE_PROFILE && run.dirty
}

function startRun(command, session) {
  const dirtyState = session.git.dirtyState()
  const dirty = dirtyState !== 'clean'
  return {
    profile: command.profile,
    // --only 나 --skip 으로 검사를 뺀 실행은 온전한 증거가 아니다.
    partial: command.only.length > 0 || command.skip.length > 0,
    commit: session.git.head() ?? NO_COMMIT,
    dirty,
    dirtyState,
    isDirtyRelease: isDirtyRelease({ profile: command.profile, dirty }),
    startedAt: new Date().toISOString(),
    lanekitVersion: readLanekitVersion(session.root, KIT_DIR),
    changedFiles: command.profile === 'changed' ? session.git.changedFiles(command.base) : null,
  }
}

/** 검사 하나: 건너뛰거나, 돌려서 판정을 붙인다. */
async function runStep(step, session, run, baselines) {
  const base = { id: step.id, mode: step.mode, action: step.action }
  if (step.action === 'skip') {
    return { ...base, status: 'skip', verdict: 'skip', reason: step.reason, summary: '', findings: [], metrics: {}, durationMs: 0 }
  }
  const baseline = baselines[step.id] ?? null
  const result = await runCheck(step, session, { ...run, baseline })
  // 래칫 판정은 기준선 파일과 재잠금 이력을 함께 읽는다. 이력에 없는 기준선 증가를 실패로 보기 위해서다.
  const logged = step.mode === 'ratchet' ? readLoggedLock(session.root, step.id) : null
  return { ...base, ...result, ...judge({ mode: step.mode, result, baseline, logged }) }
}

async function runSteps(steps, session, run, baselines) {
  const outcomes = []
  for (const step of steps) outcomes.push(await runStep(step, session, run, baselines))
  return outcomes
}

function planRun(command, session) {
  const unknown = unknownIds(session.checks, [...command.only, ...command.skip])
  if (unknown.length > 0) throw new UsageError('unknown-check', unknown.join(', '))
  const steps = planChecks({ ...command, checks: session.checks, config: session.config })
  const baselines = readBaselines(session.root, steps)
  const problems = ratchetProblems(steps, baselines)
  if (problems.length > 0) throw new ConfigError(problems, session.config.lang)
  return { steps, baselines }
}

function writeJsonResult(file, result) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`)
}

// 증거 파일이 있어야 도는 검사(meta.afterEvidence)는 증거 파일을 쓴 뒤에 돌린다.
const isDeferred = (step) => step.action === 'run' && Boolean(step.check.meta?.afterEvidence)

/** 프로필 실행: 계획 → 검사 → 증거 파일 → 증거 뒤 검사 → 출력. 실패한 검사가 있거나 full 프로필인데 작업 트리가 dirty 면 1 이다. */
async function runProfile(command, session, write) {
  const { steps, baselines } = planRun(command, session)
  const run = startRun(command, session)
  const blocked = command.writesEvidence ? blockedEvidencePath(session.root, run) : null
  if (blocked) throw new BlockedPathError(blocked)
  const deferredSteps = steps.filter(isDeferred)
  const outcomes = await runSteps(steps.filter((step) => !isDeferred(step)), session, run, baselines)
  run.finishedAt = new Date().toISOString()

  const evidenceFile = command.writesEvidence
    ? writeEvidence(session.root, buildEvidence(run, outcomes, deferredSteps.map((step) => step.id)))
    : null
  outcomes.push(...(await runSteps(deferredSteps, session, { ...run, evidencePath: evidenceFile }, baselines)))

  const shownEvidence = evidenceFile && toPosixPath(relative(session.root, evidenceFile))
  write(formatRun({ run, outcomes, evidenceFile: shownEvidence }, session.t))
  if (command.jsonFile) writeJsonResult(resolve(session.cwd, command.jsonFile), { run, outcomes })
  return outcomes.some((outcome) => outcome.verdict === 'fail') || run.isDirtyRelease ? 1 : 0
}

function relockTargets(target, session) {
  const toStep = (check) => ({ id: check.id, mode: effectiveMode(session.config, check.id), check })
  if (target === 'all') {
    return session.checks
      .filter((check) => check.installed && check.meta.ratchetable)
      .map(toStep)
      .filter((step) => step.mode !== 'off')
  }
  const check = session.checks.find((candidate) => candidate.id === target)
  if (!check) throw new UsageError('unknown-check', target)
  if (!check.installed) throw new UsageError('check-not-installed', target)
  if (!check.meta.ratchetable) throw new UsageError('not-ratchetable', target)
  return [toStep(check)]
}

function relockRequest(command, session) {
  const moves = command.movesFile ? readMoves(resolve(session.cwd, command.movesFile)) : []
  if (moves === null) throw new UsageError('bad-moves', command.movesFile)
  return { reason: command.reason, allowIncrease: command.allowIncrease, decision: command.decision, moves, isAll: command.target === 'all' }
}

const hasSameSums = (left, right) => JSON.stringify(Object.entries(sumByRule(left)).sort()) === JSON.stringify(Object.entries(sumByRule(right)).sort())

/**
 * 검사를 돌려 지금 값을 얻고, 받아들일지 판정만 한다. 쓰지는 않는다.
 * 검사에는 ctx.relock 을 참으로 넘긴다. 검사가 relockValues 를 내면 판정은 current 로 하고 기준선에는 relockValues 를 쓴다.
 * 검사가 스스로 건너뛰면 잠글 값이 없다. `all` 에서는 그 검사만 건너뛰고, 검사를 직접 고른 경우에는 거절한다.
 */
async function draftRelock(step, session, request) {
  const baseline = readBaseline(session.root, step.id)
  const result = await runCheck(step, session, { profile: 'full', changedFiles: null, baseline, relock: true })
  const draft = { id: step.id, decision: request.decision, values: result.relockValues ?? result.current, note: result.summary }
  if (result.status === 'skip') return { ...draft, plan: request.isAll ? { accepted: true, skipped: true } : { accepted: false, refusal: 'check-skipped' } }
  if (result.status === 'error' || !result.current) return { ...draft, plan: { accepted: false, refusal: 'no-current' } }
  // 기준선에 쓸 값은 판정한 값과 규칙별 합계가 같아야 한다. 다르면 판정을 거치지 않은 값이 잠긴다.
  if (!hasSameSums(draft.values, result.current)) return { ...draft, plan: { accepted: false, refusal: 'no-current' } }
  const decisionExists = hasDecisionFile(session.root, request.decision)
  const logged = readLoggedLock(session.root, step.id)
  return { ...draft, plan: planRelock({ current: result.current, baseline, request, decisionExists, logged }) }
}

/** 재잠금: 대상 검사를 모두 판정한 뒤, 하나도 거절되지 않았을 때만 쓴다. 거절이 있으면 1 이다. */
async function relockBaselines(command, session, write) {
  const request = relockRequest(command, session)
  const drafts = []
  for (const step of relockTargets(command.target, session)) drafts.push(await draftRelock(step, session, request))
  const isRefused = drafts.some((draft) => !draft.plan.accepted)
  if (!isRefused) {
    const stamp = { root: session.root, request, commit: session.git.head() ?? NO_COMMIT, now: new Date().toISOString() }
    const lockable = drafts.filter((draft) => !draft.plan.skipped)
    const [blocked] = blockedRelockPaths(session.root, lockable.map((draft) => draft.id))
    if (blocked) throw new BlockedPathError(blocked)
    for (const draft of lockable) applyRelock({ ...stamp, id: draft.id, current: draft.values, plan: draft.plan })
  }
  write(formatRelock(drafts, session.t))
  return isRefused ? 1 : 0
}

function listChecks(command, session, write) {
  const rows = session.checks.map((check) => ({
    id: check.id,
    mode: effectiveMode(session.config, check.id),
    installed: check.installed,
    profiles: check.meta?.profiles ?? [],
    ratchetable: Boolean(check.meta?.ratchetable),
  }))
  write(formatList(rows, session.t))
  return 0
}

const HANDLERS = { run: runProfile, relock: relockBaselines, list: listChecks }

/** 게이트의 진입 함수. 종료 코드를 돌려준다: 0 통과 · 1 실패 · 2 설정이나 사용법 오류, 또는 쓸 수 없는 경로. */
export async function runGate({ argv, cwd, write, registry }) {
  let lang = 'ko'
  try {
    const session = await openSession(cwd, registry)
    lang = session.config.lang
    const command = parseGateArgs(argv)
    return await HANDLERS[command.command](command, session, write)
  } catch (error) {
    if (error instanceof ConfigError) {
      write(formatProblems(error.problems, createKitTranslator(error.lang)))
      return 2
    }
    if (error instanceof UsageError) {
      write(formatUsage(error, createKitTranslator(lang)))
      return 2
    }
    // 증거 · 기준선을 쓸 자리가 링크라서 쓰지 않았다. 검사 결과가 아니라 환경 문제라서 2 로 끝낸다.
    if (error instanceof BlockedPathError) {
      write(formatProblems([{ path: error.path, code: 'blocked-path' }], createKitTranslator(lang)))
      return 2
    }
    throw error
  }
}

if (isEntryScript(process.argv[1], import.meta.url)) {
  process.exitCode = await runGate({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    write: (text) => process.stdout.write(text),
  })
}
