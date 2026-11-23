// lanekit 명령 — 인자에서 하위 명령을 골라 그 모듈의 run 을 부른다. 하위 명령의 일은 여기에 두지 않는다.
// 부르는 곳: bin/lanekit. 테스트는 runCli 를 직접 부른다.
// 먼저 읽을 파일: 하위 명령 모듈(init.mjs · doctor.mjs · update.mjs). 모듈마다 run(context) 하나를 낸다.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createCliTranslator, pickLang } from './messages.mjs'

const LIB_DIR = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = join(LIB_DIR, '..')

// 하위 명령 → 모듈 파일. 모듈은 `export async function run({ argv, cwd, write, t: translate, pluginRoot, version, requestedLang })` 를 내고 종료 코드를 돌려준다.
const COMMAND_MODULES = { init: 'init.mjs', doctor: 'doctor.mjs', update: 'update.mjs' }

export const readVersion = () => JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8')).version

/** 순수 함수. 인자에서 --lang 값을 떼어 내고 하위 명령과 나머지 인자를 가른다. */
export function splitArgs(argv) {
  const langIndex = argv.indexOf('--lang')
  const lang = langIndex >= 0 ? argv[langIndex + 1] : undefined
  const rest = langIndex >= 0 ? argv.filter((_, index) => index !== langIndex && index !== langIndex + 1) : argv
  return { lang, command: rest[0], commandArgs: rest.slice(1) }
}

function showHelp(write, translate) {
  write(`${['cli.help.title', 'cli.help.init', 'cli.help.doctor', 'cli.help.update', 'cli.help.version'].map((key) => translate(key)).join('\n')}\n`)
}

/** 명령의 진입 함수. 종료 코드를 돌려준다: 하위 명령의 코드, 모르는 명령이면 2. */
export async function runCli({ argv, cwd, write }) {
  const { lang, command, commandArgs } = splitArgs(argv)
  const translate = createCliTranslator(pickLang(lang, cwd))
  if (command === 'version' || command === '--version') {
    write(`${readVersion()}\n`)
    return 0
  }
  if (!command || command === 'help' || command === '--help') {
    showHelp(write, translate)
    return 0
  }
  const moduleFile = COMMAND_MODULES[command] && join(LIB_DIR, COMMAND_MODULES[command])
  if (!moduleFile) {
    write(`${translate('cli.unknown-command', { command })}\n`)
    showHelp(write, translate)
    return 2
  }
  if (!existsSync(moduleFile)) {
    write(`${translate('cli.command-missing', { command })}\n`)
    return 2
  }
  const commandModule = await import(pathToFileURL(moduleFile).href)
  // requestedLang 은 --lang 으로 받은 값 그대로다. init 이 「언어를 직접 골랐는가」를 알아야 해서 넘긴다.
  return commandModule.run({ argv: commandArgs, cwd, write, t: translate, pluginRoot: PLUGIN_ROOT, version: readVersion(), requestedLang: lang })
}
