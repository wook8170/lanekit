// 하위 명령의 인자 해석 — 선언한 플래그만 받아 { 이름: 값 } 으로 돌려준다. 모르는 플래그는 오류로 알린다.
// 부르는 곳: init.mjs · doctor.mjs · update.mjs.
// 먼저 읽을 파일: cli.mjs(하위 명령에 인자를 넘기는 곳).

/** 인자 오류. 하위 명령은 이 오류를 종료 코드 2 로 바꾼다. code 는 메시지 키의 끝부분이다. */
export class FlagError extends Error {
  constructor(code, flag) {
    super(`${code} ${flag}`)
    this.name = 'FlagError'
    this.code = code
    this.flag = flag
  }
}

/**
 * 순수 함수. spec 은 { '--이름': 'value' | 'switch' } 다.
 * value 플래그는 다음 인자를 값으로 받고, switch 플래그는 true 가 된다. 돌려주는 키는 '--' 를 뗀 이름이다.
 */
export function parseFlags(argv, spec) {
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const kind = spec[flag]
    if (!kind) throw new FlagError('unknown-flag', flag)
    if (kind === 'switch') {
      flags[flag.slice(2)] = true
      continue
    }
    const value = argv[index + 1]
    if (value === undefined) throw new FlagError('missing-value', flag)
    flags[flag.slice(2)] = value
    index += 1
  }
  return flags
}

/** 쉼표로 이은 값을 목록으로 바꾼다. 'none' 과 빈 값은 빈 목록이다. */
export function splitList(value) {
  if (!value || value === 'none') return []
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}
