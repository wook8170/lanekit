// 메시지 읽기 — messages.<언어>.json 을 읽어 t(key, vars) 함수를 만든다.
// 부르는 곳: gate.mjs(공통 메시지), runner.mjs(검사 폴더의 메시지를 겹친다), 플러그인 쪽 lib/messages.mjs.
// 먼저 읽을 파일: messages.ko.json(키 목록).
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const KIT_LIB_DIR = dirname(fileURLToPath(import.meta.url))

/** dir 의 messages.<lang>.json 을 읽는다. 파일이 없으면 빈 표다. */
export function loadMessages(dir, lang) {
  const file = join(dir, `messages.${lang}.json`)
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
}

/** 앞에 있는 표가 먼저다. 어느 표에도 없는 키는 키 이름을 그대로 돌려줘 빠진 곳이 눈에 띄게 한다. */
export function createTranslator(tables) {
  return (key, vars = {}) => {
    const table = tables.find((candidate) => candidate[key] !== undefined)
    if (!table) return key
    return table[key].replace(/\{(\w+)\}/g, (placeholder, name) => (vars[name] === undefined ? placeholder : String(vars[name])))
  }
}

/** 실행기 공통 메시지의 번역 함수. extraDirs 의 메시지가 공통 메시지보다 먼저다. */
export function createKitTranslator(lang, extraDirs = []) {
  const dirs = [...extraDirs, KIT_LIB_DIR]
  return createTranslator(dirs.map((dir) => loadMessages(dir, lang)))
}
