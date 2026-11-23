// 금지어 목록 — 저장소 밖의 목록 파일을 찾아 읽고, 글 한 줄이 어느 규칙에 맞는지 번호로만 알려 준다.
// 부르는 곳: run.mjs.
// 먼저 읽을 파일: run.mjs(파일과 이력의 줄을 이 목록에 넘기는 곳).
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { splitLines, userConfigDir } from '../../lib/platform.mjs'

export const DENYLIST_ENV = 'LANEKIT_DENYLIST'
export const DENYLIST_NAME = 'denylist.txt'

/** 목록 파일을 찾는다. 환경 변수가 먼저고, 다음은 사용자 설정 폴더다(`~/.config/lanekit`, Windows 는 `%APPDATA%\lanekit`). 없으면 null 이다. */
export function findDenylistFile(env = process.env) {
  const candidates = [env[DENYLIST_ENV], join(userConfigDir({ env, home: env.HOME ?? homedir() }), DENYLIST_NAME)]
  return candidates.filter(Boolean).find((candidate) => existsSync(candidate)) ?? null
}

// 같은 한글도 합친 꼴(NFC)과 풀어 쓴 꼴(NFD)이 있다. macOS 에서 복사한 파일 이름은 NFD 라서, 금지어와 견줄 글을 모두 NFC 로 맞춘다.
const toComparableText = (text) => text.normalize('NFC')

/**
 * 순수 함수. 목록의 글을 규칙으로 바꾼다. 한 줄에 정규식 하나이고 `#` 으로 시작하는 줄과 빈 줄은 건너뛴다.
 * 규칙의 번호는 목록 파일의 줄 번호다. 돌려주는 값은 { rules: [{ number, pattern }], invalidLines: [번호] } 다.
 */
export function parseDenylist(text) {
  const rules = []
  const invalidLines = []
  splitLines(text).forEach((raw, index) => {
    const source = toComparableText(raw.trim())
    if (source === '' || source.startsWith('#')) return
    try {
      rules.push({ number: index + 1, pattern: new RegExp(source, 'i') })
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      invalidLines.push(index + 1)
    }
  })
  return { rules, invalidLines }
}

export const readDenylist = (file) => parseDenylist(readFileSync(file, 'utf8'))

/** 글 한 줄이 맞는 규칙의 번호들. 맞은 낱말은 돌려주지 않는다. 줄은 금지어와 같은 꼴(NFC)로 맞춘 뒤 견준다. */
export function matchRuleNumbers(lineText, rules) {
  const comparable = toComparableText(lineText)
  return rules.filter((rule) => rule.pattern.test(comparable)).map((rule) => rule.number)
}
