// 게이트 인자 해석 — 명령줄 인자를 「돌리기 · 재잠금 · 목록」 가운데 하나의 명령으로 바꾼다.
// 부르는 곳: gate.mjs(가장 먼저).
// 먼저 읽을 파일: gate.mjs(명령마다 처리 함수가 있다).
import { parseArgs } from 'node:util'
import { PROFILES } from './profile.mjs'

/** 사용법 오류. 게이트는 이 오류를 종료 코드 2 로 바꾼다. */
export class UsageError extends Error {
  constructor(code, detail = '') {
    super(`${code} ${detail}`.trim())
    this.name = 'UsageError'
    this.code = code
    this.detail = detail
  }
}

const OPTIONS = {
  profile: { type: 'string' },
  only: { type: 'string' },
  skip: { type: 'string' },
  base: { type: 'string' },
  json: { type: 'string' },
  'no-evidence': { type: 'boolean' },
  relock: { type: 'string' },
  reason: { type: 'string' },
  'allow-increase': { type: 'boolean' },
  decision: { type: 'string' },
  moves: { type: 'string' },
  list: { type: 'boolean' },
}

const splitIds = (joined) => (joined ? joined.split(',').map((id) => id.trim()).filter(Boolean) : [])

function readFlags(argv) {
  try {
    return parseArgs({ args: argv, options: OPTIONS, allowPositionals: false, strict: true }).values
  } catch (error) {
    throw new UsageError('bad-flag', error.message)
  }
}

function runCommand(flags) {
  const profile = flags.profile ?? 'light'
  if (!PROFILES.includes(profile)) throw new UsageError('bad-profile', profile)
  return {
    command: 'run',
    profile,
    only: splitIds(flags.only),
    skip: splitIds(flags.skip),
    base: flags.base ?? null,
    jsonFile: flags.json ?? null,
    writesEvidence: !flags['no-evidence'],
  }
}

// 사유와 결정 ID 가 충분한지는 여기서 보지 않는다. 그 판정은 baseline.mjs 의 planRelock 한 곳에 있다.
function relockCommand(flags) {
  if (!flags.relock) throw new UsageError('relock-target-missing')
  return {
    command: 'relock',
    target: flags.relock,
    reason: flags.reason ?? '',
    allowIncrease: Boolean(flags['allow-increase']),
    decision: flags.decision ?? null,
    movesFile: flags.moves ?? null,
  }
}

/** 순수 함수. 인자 목록을 명령 객체로 바꾼다. 모르는 플래그나 프로필은 UsageError 다. */
export function parseGateArgs(argv) {
  const flags = readFlags(argv)
  if (flags.list) return { command: 'list' }
  if (flags.relock !== undefined) return relockCommand(flags)
  return runCommand(flags)
}
