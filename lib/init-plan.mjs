// init 의 판정 — 답을 확정하고, 설정 파일의 내용과 만들 파일 목록을 계산한다. 아무것도 쓰지 않는다.
// 부르는 곳: init.mjs(계획을 보여 주고 init-apply 에 넘긴다).
// 먼저 읽을 파일: template-map.mjs(틀과 파일의 짝), init-apply.mjs(계획대로 쓰는 쪽).
import { CHECK_IDS, MODULE_NAMES } from '../kit/lib/schema.mjs'
import { validateConfig } from '../kit/lib/config.mjs'
import { splitLines, toLfBytes } from '../kit/lib/platform.mjs'
import { FlagError, splitList } from './flags.mjs'
import { KIT_TARGET } from './kit-source.mjs'
import { LOCK_FILE, LOCK_SCHEMA } from './lock.mjs'
import { renderTemplate } from './render.mjs'
import { HOOK_SOURCE, HOOK_TARGET, OFFERED_TEMPLATES, SUGGESTIONS_DIR, TEMPLATE_TARGETS, templateValues } from './template-map.mjs'

export const KINDS = ['web-ui', 'service', 'library', 'other']
export const REMOTE_GATES = ['git-hook', 'github', 'gitlab', 'none']
const DEFAULT_DOCS_DIR = 'docs'

function pick(flagName, value, allowed) {
  if (!allowed.includes(value)) throw new FlagError('bad-value', `--${flagName} ${value}`)
  return value
}

/**
 * 순수 판정. 플래그가 있으면 그 값을, 없으면 감지 결과를 쓴다. 받지 않는 값은 FlagError 로 알린다.
 * lang 은 부르는 쪽이 정해서 넘긴다(--lang → 레인키퍼 개인 설정 → ko).
 */
export function resolveAnswers(flags, detected, lang) {
  const modules = flags.modules === undefined ? detected.modules : splitList(flags.modules)
  for (const name of modules) pick('modules', name, MODULE_NAMES)
  return {
    lang,
    kind: pick('kind', flags.kind ?? detected.kind, KINDS),
    modules,
    tests: { full: flags['test-full'] ?? detected.tests.full, changed: flags['test-changed'] ?? detected.tests.changed },
    remoteGate: pick('remote-gate', flags['remote-gate'] ?? detected.remoteGate, REMOTE_GATES),
  }
}

/** 순수 함수. lanekit.config.json 의 내용. 검사마다 기본 모드를 적어 두어, 사용자가 고칠 자리를 보게 한다. */
export function buildConfig(answers, detected) {
  const defaults = validateConfig({}).config.checks
  const checks = Object.fromEntries(CHECK_IDS.map((id) => [id, { mode: defaults[id].mode }]))
  checks.tests = { ...checks.tests, full: answers.tests.full, changed: answers.tests.changed }
  if (detected.docsDir && detected.docsDir !== DEFAULT_DOCS_DIR) {
    checks.writing = { ...checks.writing, globs: [`${detected.docsDir}/**/*.md`, 'README*.md'] }
  }
  return {
    version: 1,
    lang: answers.lang,
    repo: { visibility: 'private' },
    modules: answers.modules,
    remote_gate: answers.remoteGate,
    checks,
  }
}

const toBuffer = (text) => Buffer.from(text, 'utf8')
const toJson = (value) => `${JSON.stringify(value, null, 2)}\n`

function templateTargets(templates, answers, values) {
  const wanted = TEMPLATE_TARGETS.filter((entry) => !entry.gates || entry.gates.includes(answers.remoteGate))
  const render = (entry) => toBuffer(renderTemplate(templates[entry.source], values))
  return [
    ...wanted.map((entry) => ({ path: entry.target, content: render(entry), group: 'template' })),
    ...OFFERED_TEMPLATES.map((entry) => ({ path: entry.target, content: render(entry), group: 'offer' })),
  ]
}

function kitTargets(kitFiles, answers, version) {
  const copies = kitFiles.map((file) => ({ ...file, path: `${KIT_TARGET}/${file.path}`, group: 'kit' }))
  const lock = { schema: LOCK_SCHEMA, version, files: Object.fromEntries(kitFiles.map((file) => [file.path, file.hash])) }
  const hook = kitFiles.find((file) => file.path === HOOK_SOURCE)
  const hookTargets = hook && answers.remoteGate !== 'none' ? [{ ...hook, path: HOOK_TARGET, executable: true, group: 'hook' }] : []
  return [...copies, { path: `${KIT_TARGET}/${LOCK_FILE}`, content: toBuffer(toJson(lock)), group: 'lock' }, ...hookTargets]
}

/**
 * 순수 함수. 만들 파일을 { path, content, executable, group } 목록으로 돌려준다.
 * sources 는 { templates: { 틀 경로: 본문 }, kitFiles, version } 이다.
 */
export function listTargets(answers, detected, sources) {
  const config = { path: 'lanekit.config.json', content: toBuffer(toJson(buildConfig(answers, detected))), group: 'config' }
  return [
    config,
    ...kitTargets(sources.kitFiles, answers, sources.version),
    ...templateTargets(sources.templates, answers, templateValues(detected)),
  ]
}

// 이미 있는 파일을 어떻게 다룰지. 제안 폴더는 lanekit 의 것이라 다시 쓰고, 잠금 파일은 한 번 쓴 뒤에는 update 만 바꾼다.
// 줄바꿈만 다른 파일(CRLF 로 체크아웃된 것)은 같은 파일로 본다.
function actionFor(target, existing) {
  if (existing === undefined || target.group === 'offer') return 'write'
  if (target.group === 'lock' || Buffer.compare(toLfBytes(existing), toLfBytes(target.content)) === 0) return 'keep'
  return 'suggest'
}

/**
 * 순수 판정. 이미 있는 파일은 덮어쓰지 않는다. 내용이 같으면 keep, 다르면 suggest 다.
 * existing 은 { 경로: 지금 내용(Buffer) } 이고 없는 파일은 키가 없다.
 */
export function planInit(targets, existing) {
  return targets.map((target) => {
    const action = actionFor(target, existing[target.path])
    return { ...target, action, writePath: action === 'suggest' ? `${SUGGESTIONS_DIR}/${target.path}` : target.path }
  })
}

const IGNORE_LINES = ['.lanekit/', '.env']

/**
 * 순수 판정. .gitignore 에 넣을 줄을 정한다. 파일이 없으면 만들고, 있으면 허락(allowEdit)이 있을 때만 덧붙인다.
 * 돌려주는 값은 { action: 'write' | 'append' | 'keep' | 'suggest', missing, content } 다.
 */
export function planGitignore(existingText, allowEdit) {
  if (existingText === undefined) return { action: 'write', missing: IGNORE_LINES, content: `${IGNORE_LINES.join('\n')}\n` }
  const present = splitLines(existingText).map((line) => line.trim())
  const missing = IGNORE_LINES.filter((line) => !present.includes(line) && !present.includes(line.replace(/\/$/, '')))
  if (missing.length === 0) return { action: 'keep', missing, content: existingText }
  const separator = existingText.endsWith('\n') || existingText === '' ? '' : '\n'
  return { action: allowEdit ? 'append' : 'suggest', missing, content: `${existingText}${separator}${missing.join('\n')}\n` }
}
