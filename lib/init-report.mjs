// init 의 출력 — 감지 결과와 답, 만들 파일 목록, 커밋할 파일 목록을 사람이 읽는 줄로 바꾼다. 모두 순수 함수다.
// 부르는 곳: init.mjs.
// 먼저 읽을 파일: init-plan.mjs(계획의 모양).
import { KIT_TARGET } from './kit-source.mjs'

const ACTION_MARKS = { write: '+', keep: '=', suggest: '?', blocked: '!' }
const NONE = '-'

/** 답 다섯 가지를 한 줄씩 낸다. */
export function formatAnswers(answers, translate) {
  const rows = [
    ['init.answer.lang', answers.lang],
    ['init.answer.kind', answers.kind],
    ['init.answer.modules', answers.modules.join(', ') || NONE],
    ['init.answer.test-full', answers.tests.full || NONE],
    ['init.answer.test-changed', answers.tests.changed || NONE],
    ['init.answer.remote-gate', answers.remoteGate],
  ]
  return [translate('init.answers'), ...rows.map(([key, value]) => `  ${translate(key)}: ${value}`)]
}

// 복사본은 파일이 많으므로 그대로 쓰는 것과 그대로 두는 것은 폴더 한 줄로 묶는다. 제안으로 가는 파일만 하나씩 보인다.
function kitLines(plan, translate) {
  const kitEntries = plan.filter((entry) => entry.group === 'kit')
  const countOf = (action) => kitEntries.filter((entry) => entry.action === action).length
  const grouped = ['write', 'keep']
    .filter((action) => countOf(action) > 0)
    .map((action) => `  ${ACTION_MARKS[action]} ${KIT_TARGET}/ ${translate('init.plan.files', { count: countOf(action) })}`)
  const conflicts = kitEntries.filter((entry) => entry.action === 'suggest').map((entry) => `  ? ${entry.path}`)
  return [...grouped, ...conflicts]
}

/** 만들 파일 목록. + 는 새로 쓴다, = 는 이미 같다, ? 는 이미 있어서 제안 폴더에 둔다는 뜻이다. */
export function formatPlan(plan, gitignorePlan, translate) {
  const others = plan.filter((entry) => entry.group !== 'kit' && entry.group !== 'offer')
  const offers = plan.filter((entry) => entry.group === 'offer')
  const gitignoreMark = { write: '+', append: '+', keep: '=', suggest: '?', blocked: '!' }[gitignorePlan.action]
  return [
    translate('init.plan'),
    ...kitLines(plan, translate),
    ...others.map((entry) => `  ${ACTION_MARKS[entry.action]} ${entry.path}`),
    `  ${gitignoreMark} .gitignore${gitignorePlan.missing.length > 0 ? ` (${gitignorePlan.missing.join(' ')})` : ''}`,
    translate('init.plan.offers'),
    ...offers.map((entry) => `  + ${entry.path}`),
    translate('init.plan.legend'),
  ]
}

/** 제안 폴더에 둔 파일의 목록. 사용자가 원래 파일에 직접 합친다. */
export function formatSuggestions(plan, translate) {
  const suggested = plan.filter((entry) => entry.action === 'suggest')
  if (suggested.length === 0) return []
  return [translate('init.suggested'), ...suggested.map((entry) => `  ${entry.path} → ${entry.writePath}`)]
}

/** 순수 함수. 커밋할 경로 목록. 복사본은 폴더 하나로 적고, git 이 빼는 제안 폴더는 넣지 않는다. */
export function listCommitPaths(plan, extraPaths) {
  const written = plan.filter((entry) => entry.action === 'write' && entry.group !== 'offer')
  const hasKitChange = written.some((entry) => entry.group === 'kit' || entry.group === 'lock')
  const single = written.filter((entry) => entry.group !== 'kit' && entry.group !== 'lock').map((entry) => entry.path)
  return [...(hasKitChange ? [`${KIT_TARGET}/`] : []), ...single, ...extraPaths]
}
