// init 명령 — 저장소를 감지하고, 만들 파일을 계산해 보여 주고, 확인(--yes)을 받으면 쓴 뒤 게이트와 doctor 를 돌린다. 커밋하지 않는다.
// 부르는 곳: cli.mjs(`lanekit init`). 질문은 skills/init 이 하고 답을 플래그로 넘긴다.
// 먼저 읽을 파일: init-plan.mjs(판정) → init-apply.mjs(쓰기) → init-followup.mjs(쓴 뒤의 단계).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { baselineDir } from '../kit/lib/baseline.mjs'
import { readPersonalLanguage } from './claude-home.mjs'
import { detectProject } from './detect.mjs'
import { runDoctor } from './doctor.mjs'
import { localMachine } from './doctor-context.mjs'
import { FlagError, parseFlags } from './flags.mjs'
import { applyGitignore, applyPlan, markBlocked, readExisting, withGitignoreTarget } from './init-apply.mjs'
import { linkLanekeeper, lockBaselines, runLightGate, setHooksPath, stageHookAsExecutable } from './init-followup.mjs'
import { listTargets, planGitignore, planInit, resolveAnswers } from './init-plan.mjs'
import { formatAnswers, formatPlan, formatSuggestions, listCommitPaths } from './init-report.mjs'
import { readKitSources } from './kit-source.mjs'
import { LANEKEEPER_CONFIG } from './lanekeeper-link.mjs'
import { listFiles } from './lock.mjs'
import { LANGS, createCliTranslator } from './messages.mjs'
import { runCommand } from './process.mjs'
import { readProjectConfig } from './project-config.mjs'
import { HOOK_TARGET, SUGGESTIONS_DIR } from './template-map.mjs'

const FLAGS = {
  '--kind': 'value',
  '--modules': 'value',
  '--test-full': 'value',
  '--test-changed': 'value',
  '--remote-gate': 'value',
  '--yes': 'switch',
  '--lock-baselines': 'switch',
  '--set-hooks-path': 'switch',
  '--edit-gitignore': 'switch',
}

/** 순수 판정. 언어를 고른다: --lang → 이미 있는 설정의 값 → 레인키퍼 개인 설정 → ko. */
export function pickInitLang({ requested, configured, personal }) {
  return [requested, configured, personal].find((candidate) => LANGS.includes(candidate)) ?? 'ko'
}

function readTemplates(pluginRoot, lang) {
  const dir = join(pluginRoot, 'templates', lang)
  return Object.fromEntries(listFiles(dir).map((path) => [path, readFileSync(join(dir, path), 'utf8')]))
}

const readTextOrUndefined = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : undefined)

/** 읽기만 한다. 감지하고 답을 정해, 쓸 계획 { answers, plan, gitignorePlan, missingModules } 를 만든다. */
function prepare({ root, flags, lang, pluginRoot, version, exec }) {
  const detected = detectProject(root, exec)
  const answers = resolveAnswers(flags, detected, lang)
  const kit = readKitSources(pluginRoot, answers.modules)
  const targets = listTargets(answers, detected, { templates: readTemplates(pluginRoot, lang), kitFiles: kit.files, version })
  const gitignorePlan = planGitignore(readTextOrUndefined(join(root, '.gitignore')), Boolean(flags['edit-gitignore']))
  return {
    answers,
    plan: markBlocked(root, planInit(targets, readExisting(root, targets.map((target) => target.path)))),
    gitignorePlan: markBlocked(root, [withGitignoreTarget(gitignorePlan, SUGGESTIONS_DIR)])[0],
    missingModules: kit.missingModules,
  }
}

function showPlan({ answers, plan, gitignorePlan, missingModules }, say, write) {
  const blocked = [...plan, gitignorePlan].filter((entry) => entry.action === 'blocked').map((entry) => say('init.blocked', { path: entry.writePath }))
  const notices = [...missingModules.map((name) => say('init.module-missing', { name })), ...blocked]
  write(`${[...formatAnswers(answers, say), ...formatPlan(plan, gitignorePlan, say), ...notices].join('\n')}\n`)
}

// 쓴 뒤의 단계. 단계마다 결과를 한 줄로 알리고, 커밋할 경로에 더할 것을 돌려준다.
function followUp({ root, flags, answers, exec }, say, write) {
  const extraPaths = []
  const link = linkLanekeeper({ root, exec, answers })
  write(`${say(`init.lanekeeper.${link.outcome}`, { path: link.path })}\n`)
  if (link.outcome === 'created') extraPaths.push(LANEKEEPER_CONFIG)

  if (flags['set-hooks-path']) {
    const hooks = setHooksPath({ root, exec })
    write(`${say(`init.hooks.${hooks.outcome}`, { existing: hooks.existing })}\n`)
  } else if (answers.remoteGate !== 'none') {
    write(`${say('init.hooks.ask')}\n`)
  }

  const hookMode = stageHookAsExecutable({ root, exec })
  if (hookMode.outcome !== 'not-needed') write(`${say(`init.hook-mode.${hookMode.outcome}`, { file: HOOK_TARGET })}\n`)

  const gate = runLightGate({ exec })
  write(`${say('init.gate.heading')}\n${gate.stdout}${say('init.gate.exit', { code: gate.code })}\n`)

  if (flags['lock-baselines']) {
    const relock = lockBaselines({ exec })
    write(`${say('init.relock.heading')}\n${relock.stdout}`)
    if (existsSync(baselineDir(root))) extraPaths.push('scripts/lanekit/baselines/')
  } else {
    write(`${say('init.relock.ask')}\n`)
  }
  return extraPaths
}

async function applyAndReport(prepared, session, say) {
  const { root, write, pluginRoot, version, machine } = session
  applyPlan(root, prepared.plan)
  applyGitignore(root, prepared.gitignorePlan)
  write(`${[say('init.written'), ...formatSuggestions(prepared.plan, say)].join('\n')}\n`)
  if (prepared.gitignorePlan.action === 'suggest') write(`${say('init.gitignore.ask', { lines: prepared.gitignorePlan.missing.join(' ') })}\n`)

  const extraPaths = followUp({ root, flags: session.flags, answers: prepared.answers, exec: session.exec }, say, write)
  await runDoctor({ root, translate: say, pluginRoot, version, write, asJson: false }, machine)

  const isGitignoreChanged = ['write', 'append'].includes(prepared.gitignorePlan.action)
  const commitPaths = listCommitPaths(prepared.plan, [...(isGitignoreChanged ? ['.gitignore'] : []), ...extraPaths])
  const commitLines = commitPaths.length > 0 ? commitPaths.map((path) => `  ${path}`) : [say('init.commit.none')]
  write(`${[say('init.commit'), ...commitLines].join('\n')}\n`)
}

/** 하위 명령의 진입 함수. --yes 가 없으면 계획만 보여 주고 아무것도 쓰지 않는다. */
export async function run({ argv, cwd, write, t: translate, pluginRoot, version, requestedLang }, machine = localMachine()) {
  try {
    const flags = parseFlags(argv, FLAGS)
    const project = readProjectConfig(cwd)
    const configured = project.found ? project.config.lang : undefined
    const lang = pickInitLang({ requested: requestedLang, configured, personal: readPersonalLanguage(machine) })
    const say = createCliTranslator(lang)
    const exec = (command, args) => runCommand(command, args, { cwd, env: machine.env })
    const prepared = prepare({ root: cwd, flags, lang, pluginRoot, version, exec })
    showPlan(prepared, say, write)
    if (!flags.yes) {
      write(`${say('init.dry-run')}\n`)
      return 0
    }
    await applyAndReport(prepared, { root: cwd, write, pluginRoot, version, machine, flags, exec }, say)
    return 0
  } catch (error) {
    if (!(error instanceof FlagError)) throw error
    write(`${translate(`cli.${error.code}`, { flag: error.flag })}\n`)
    return 2
  }
}
