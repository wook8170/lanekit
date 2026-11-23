// 지침 파일 읽기 — I1 ~ I3 이 함께 쓴다. 설정의 guidance.files 가운데 있는 파일만 { file, text, bytes } 로 읽는다.
// 부르는 곳: i1-guidance-size.mjs · i2-guidance-paths.mjs · i3-guidance-headings.mjs.
// 먼저 읽을 파일: ../../kit/checks/guidance/rules.mjs(이 문서들을 받는 규칙 함수).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readProjectConfig } from '../project-config.mjs'

/** { docs, settings } 를 돌려준다. settings 는 설정의 checks.guidance 다. */
export function readGuidanceDocs(root) {
  const settings = readProjectConfig(root).config.checks.guidance
  const present = settings.files.filter((file) => existsSync(join(root, file)))
  const docs = present.map((file) => {
    const content = readFileSync(join(root, file))
    return { file, text: content.toString('utf8'), bytes: content.length }
  })
  return { docs, settings }
}

/** 찾은 것을 `파일:줄` 로 적는다. 줄이 없는 규칙은 파일만 적는다. */
export const locate = (finding) => (finding.line ? `${finding.file}:${finding.line}` : finding.file)
