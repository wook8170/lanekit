// 검사 등록표 — 검사 ID 가 어느 파일에 있는지 적고, 그 파일과 켠 모듈의 폴더를 찾는다.
// 부르는 곳: gate.mjs(실행 전에 검사와 모듈을 읽는다).
// 먼저 읽을 파일: checks/guidance/run.mjs(검사 모듈의 견본).
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ConfigError } from './config.mjs'

// 순서가 곧 실행 순서다. 가벼운 검사를 앞에, 외부 명령을 부르는 검사를 뒤에 둔다.
const CHECK_FILES = [
  ['structure', 'structure/run.mjs'],
  ['docs-drift', 'docs-drift/run.mjs'],
  ['writing', 'writing/run.mjs'],
  ['secrets', 'security/secrets.mjs'],
  ['exposure', 'exposure/run.mjs'],
  ['guidance', 'guidance/run.mjs'],
  ['wiki', 'wiki/run.mjs'],
  ['tests', 'tests/run.mjs'],
  ['audit', 'security/audit.mjs'],
  ['sbom', 'security/sbom.mjs'],
  ['provenance', 'security/provenance.mjs'],
]

export const REGISTERED_IDS = CHECK_FILES.map(([id]) => id)

/** 실행기 폴더(kitDir) 기준의 등록표: [{ id, file }]. */
export function defaultRegistry(kitDir) {
  return CHECK_FILES.map(([id, file]) => ({ id, file: join(kitDir, 'checks', file) }))
}

function assertContract(entry, loaded) {
  const broken = loaded.meta?.id !== entry.id || !Array.isArray(loaded.meta?.profiles) || typeof loaded.run !== 'function'
  if (broken) throw new ConfigError([{ path: entry.file, code: 'check-contract' }])
}

/** 검사 파일 하나를 읽는다. 파일이 없으면 installed: false 로 돌려준다. */
async function loadCheck(entry) {
  if (!existsSync(entry.file)) return { ...entry, installed: false }
  const loaded = await import(pathToFileURL(entry.file).href)
  assertContract(entry, loaded)
  return { ...entry, installed: true, meta: loaded.meta, run: loaded.run, messagesDir: dirname(entry.file) }
}

export function loadChecks(registry) {
  return Promise.all(registry.map(loadCheck))
}

/** 켠 모듈의 폴더를 찾는다. 복사본에서는 실행기 폴더 안, 원본 저장소에서는 실행기 폴더 옆에 있다. */
export function findModuleDirs(kitDir, names) {
  const found = {}
  for (const name of names) {
    const candidates = [join(kitDir, 'modules', name), join(kitDir, '..', 'modules', name)]
    const dir = candidates.find((candidate) => existsSync(join(candidate, 'module.json')))
    if (!dir) throw new ConfigError([{ path: 'modules', code: 'module-not-found', got: name }])
    found[name] = dir
  }
  return found
}
