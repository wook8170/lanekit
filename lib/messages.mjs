// 플러그인 쪽 메시지 — lib/messages.<언어>.json 을 읽어 t(key, vars) 를 만든다. 읽는 규칙은 실행기와 같은 것을 쓴다.
// 부르는 곳: cli.mjs, 그리고 하위 명령(init · doctor · update).
// 먼저 읽을 파일: ../kit/lib/messages.mjs(표를 겹치는 규칙).
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createKitTranslator } from '../kit/lib/messages.mjs'

const LIB_DIR = dirname(fileURLToPath(import.meta.url))
export const LANGS = ['ko', 'en']

/** 플러그인 메시지가 먼저고, 없는 키는 실행기 공통 메시지에서 찾는다. */
export function createCliTranslator(lang) {
  return createKitTranslator(lang, [LIB_DIR])
}

// 설정 파일이 깨져 있어도 명령은 돌아야 한다. 깨진 설정은 doctor 가 알리므로 여기서는 「값 없음」으로 돌려준다.
function readConfiguredLang(configFile) {
  try {
    return JSON.parse(readFileSync(configFile, 'utf8')).lang
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
}

/** 메시지 언어를 고른다: --lang 값 → 프로젝트 설정의 lang → ko. */
export function pickLang(requested, cwd) {
  if (LANGS.includes(requested)) return requested
  const configFile = join(cwd, 'lanekit.config.json')
  const configured = existsSync(configFile) ? readConfiguredLang(configFile) : undefined
  return LANGS.includes(configured) ? configured : 'ko'
}
