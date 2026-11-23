// 프로젝트 설정 읽기(점검용) — lanekit.config.json 이 없거나 틀려도 던지지 않고, 기본값을 채운 설정과 문제 목록을 함께 돌려준다.
// 부르는 곳: doctor-checks/ 의 K · G · I · E 항목, update.mjs(켠 모듈 읽기).
// 먼저 읽을 파일: ../kit/lib/config.mjs 의 validateConfig.
import { join } from 'node:path'
import { CONFIG_FILE, validateConfig } from '../kit/lib/config.mjs'
import { isPlainObject, readJsonFile } from './json-file.mjs'

/** { found, parsed, config, problems } 를 돌려준다. config 는 항상 기본값이 채워져 있다. */
export function readProjectConfig(root) {
  const { found, value } = readJsonFile(join(root, CONFIG_FILE))
  const parsed = isPlainObject(value)
  const { config, problems } = validateConfig(parsed ? value : {})
  return { found, parsed, config, problems: parsed ? problems : [] }
}
