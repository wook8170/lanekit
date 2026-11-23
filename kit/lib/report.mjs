// 사람이 읽는 출력 — 게이트 결과 · 검사 목록 · 재잠금 결과 · 오류를 터미널에 낼 글로 바꾼다. 모두 순수 함수다.
// 부르는 곳: gate.mjs(명령 처리의 마지막).
// 먼저 읽을 파일: messages.ko.json(문장이 있는 곳).

const MAX_FINDINGS_SHOWN = 20
const HELP_KEYS = ['usage.help.run', 'usage.help.relock', 'usage.help.list']

function markOf(outcome) {
  if (outcome.verdict === 'fail') return '✗'
  if (outcome.verdict === 'skip') return outcome.reason === 'check-unverified' ? '!' : '-'
  return outcome.reason === 'clean' || outcome.reason === 'within-baseline' ? '✓' : '!'
}

// 파일 이름에 줄바꿈이나 터미널 제어 문자가 있으면 출력의 줄이 갈라져 다른 검사의 결과처럼 보일 수 있다. 눈에 보이는 꼴(\x0a)로 바꾼다.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g
const toPrintable = (text) => String(text).replace(CONTROL_CHARS, (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`)

function findingLine(finding) {
  const file = toPrintable(finding.file)
  const place = finding.line ? `${file}:${finding.line}` : file
  return `      ${place} [${finding.rule}] ${finding.message ?? ''}`.trimEnd()
}

function detailLines(outcome, translate) {
  const shown = outcome.findings.slice(0, MAX_FINDINGS_SHOWN).map(findingLine)
  const hidden = outcome.findings.length - shown.length
  if (hidden > 0) shown.push(`      ${translate('run.more', { count: hidden })}`)
  for (const increase of outcome.increases ?? []) {
    shown.push(`      + [${increase.rule}] ${toPrintable(increase.key)} ${increase.from} -> ${increase.to}`)
  }
  if (outcome.newRules?.length) shown.push(`      ${translate('ratchet.new-rules', { rules: outcome.newRules.join(', ') })}`)
  return shown
}

function outcomeLines(outcome, translate) {
  const note = outcome.action === 'skip' ? translate(`reason.${outcome.reason}`) : `${outcome.summary} (${translate(`reason.${outcome.reason}`)})`
  const head = `  ${markOf(outcome)} ${outcome.id.padEnd(11)} ${outcome.mode.padEnd(8)} ${translate(`verdict.${outcome.verdict}`)}  ${note}`
  return [head, ...detailLines(outcome, translate)]
}

// 확인하지 못해 건너뛴 검사는 실패가 아니지만, 통과한 것으로 읽히지 않게 끝에 한 줄로 다시 알린다.
function unverifiedLines(outcomes, translate) {
  const checks = outcomes.filter((outcome) => outcome.reason === 'check-unverified').map((outcome) => outcome.id)
  return checks.length > 0 ? [translate('run.unverified', { checks: checks.join(', ') })] : []
}

const countVerdict = (outcomes, verdict) => outcomes.filter((outcome) => outcome.verdict === verdict).length

/** 프로필 실행 결과. report 는 { run, outcomes, evidenceFile } 이다. */
export function formatRun({ run, outcomes, evidenceFile }, translate) {
  const dirty = run.dirty ? translate(`run.dirty.${run.dirtyState}`) : ''
  const totals = {
    failed: countVerdict(outcomes, 'fail'),
    passed: countVerdict(outcomes, 'pass'),
    skipped: countVerdict(outcomes, 'skip'),
  }
  return [
    translate('run.header', { profile: run.profile, commit: run.commit.slice(0, 12), dirty }),
    ...outcomes.flatMap((outcome) => outcomeLines(outcome, translate)),
    translate('run.totals', totals),
    evidenceFile ? translate('run.evidence', { file: evidenceFile }) : translate('run.no-evidence'),
    ...unverifiedLines(outcomes, translate),
    ...(run.isDirtyRelease ? [translate(`run.dirty-full.${run.dirtyState}`)] : []),
    '',
  ].join('\n')
}

/** --list 의 출력. rows 는 [{ id, mode, installed, profiles, ratchetable }] 이다. */
export function formatList(rows, translate) {
  const lines = rows.map((row) => {
    const detail = row.installed
      ? `${row.profiles.join(',')}${row.ratchetable ? ` · ${translate('list.ratchetable')}` : ''}`
      : translate('list.missing')
    return `  ${row.id.padEnd(11)} ${row.mode.padEnd(8)} ${detail}`
  })
  return [translate('list.header'), ...lines, ''].join('\n')
}

function draftLines(draft, translate) {
  const sums = Object.keys(draft.plan.after ?? {}).map(
    (rule) => `      [${rule}] ${draft.plan.before?.[rule] ?? '-'} -> ${draft.plan.after[rule]}`,
  )
  const increases = (draft.plan.increases ?? []).map(
    (increase) => `      + [${increase.rule}] ${toPrintable(increase.key)} ${increase.from} -> ${increase.to}`,
  )
  if (draft.plan.skipped) return [`  - ${draft.id}: ${translate('relock.skipped', { note: draft.note })}`]
  const head = draft.plan.accepted
    ? `  ✓ ${draft.id}: ${translate('relock.accepted')}`
    : `  ✗ ${draft.id}: ${translate(`relock.refused.${draft.plan.refusal}`, { decision: draft.decision ?? '', note: draft.note })}`
  return [head, ...sums, ...increases]
}

/** 재잠금 결과. 하나라도 거절되면 아무것도 쓰지 않았다는 줄을, 잠근 검사가 없으면 그 사실을 붙인다. */
export function formatRelock(drafts, translate) {
  const isRefused = drafts.some((draft) => !draft.plan.accepted)
  const isAnyLocked = drafts.some((draft) => draft.plan.accepted && !draft.plan.skipped)
  const footer = translate(isRefused ? 'relock.nothing-written' : isAnyLocked ? 'relock.written' : 'relock.nothing-to-lock')
  return [...drafts.flatMap((draft) => draftLines(draft, translate)), footer, ''].join('\n')
}

/** 설정 오류의 문제 목록. */
export function formatProblems(problems, translate) {
  const lines = problems.map((problem) => `  ${translate(`problem.${problem.code}`, problem)}`)
  return [translate('problem.header'), ...lines, ''].join('\n')
}

/** 사용법 오류와 사용법 세 줄. */
export function formatUsage(error, translate) {
  return [translate(`usage.${error.code}`, { detail: error.detail }), ...HELP_KEYS.map((key) => `  ${translate(key)}`), ''].join('\n')
}
