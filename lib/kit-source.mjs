// 복사 원본 목록 — 플러그인의 kit/ 과 켠 모듈의 파일을, 프로젝트의 scripts/lanekit/ 아래 상대 경로와 짝지어 돌려준다.
// 부르는 곳: init.mjs(처음 복사), update.mjs(새 버전으로 바꾸기).
// 먼저 읽을 파일: lock.mjs(이 목록의 해시를 잠금 파일에 적는 곳).
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { hashContent, listFiles } from './lock.mjs'

export const KIT_TARGET = 'scripts/lanekit'

const isExecutable = (file) => (statSync(file).mode & 0o111) !== 0

function readSources(dir, targetPrefix) {
  return listFiles(dir).map((relativePath) => {
    const file = join(dir, relativePath)
    const content = readFileSync(file)
    return { path: `${targetPrefix}${relativePath}`, content, hash: hashContent(content), executable: isExecutable(file) }
  })
}

/**
 * { files, missingModules } 를 돌려준다. files 의 path 는 scripts/lanekit/ 아래 상대 경로다.
 * 플러그인에 폴더가 없는 모듈은 복사하지 않고 missingModules 로 알린다.
 */
export function readKitSources(pluginRoot, modules) {
  const present = modules.filter((name) => existsSync(join(pluginRoot, 'modules', name)))
  const moduleFiles = present.flatMap((name) => readSources(join(pluginRoot, 'modules', name), `modules/${name}/`))
  return {
    files: [...readSources(join(pluginRoot, 'kit'), ''), ...moduleFiles],
    missingModules: modules.filter((name) => !present.includes(name)),
  }
}

/** 잠금 파일의 files 칸 모양 { 상대 경로: sha256 }. */
export const hashesOf = (files) => Object.fromEntries(files.map((file) => [file.path, file.hash]))
