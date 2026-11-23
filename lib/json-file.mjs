// JSON 파일 읽기 — 없거나 깨진 파일을 「값 없음」으로 돌려준다. 깨진 파일을 알리는 일은 부르는 쪽이 한다.
// 부르는 곳: detect.mjs · claude-home.mjs · lanekeeper-link.mjs · doctor-checks/.
// 먼저 읽을 파일: 없음(도우미 하나다).
import { existsSync, readFileSync } from 'node:fs'

/** { found, value } 를 돌려준다. 파일이 없으면 found 가 false, JSON 이 아니면 value 가 undefined 다. */
export function readJsonFile(file) {
  if (!existsSync(file)) return { found: false, value: undefined }
  try {
    return { found: true, value: JSON.parse(readFileSync(file, 'utf8')) }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return { found: true, value: undefined }
  }
}

/** 값만 필요할 때 쓴다. 없거나 깨졌으면 fallback 이다. */
export const readJsonOr = (file, fallback) => readJsonFile(file).value ?? fallback

export const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
