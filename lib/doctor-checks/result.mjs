// 점검 결과 만들기 — 항목이 돌려주는 { status, message, fix } 를 만드는 도우미다.
// 부르는 곳: 이 폴더의 점검 항목 전부.
// 먼저 읽을 파일: index.mjs(항목 목록과 순서).

export const STATUSES = ['ok', 'warn', 'fail', 'skip']

export const ok = (message) => ({ status: 'ok', message, fix: '' })
export const skip = (message) => ({ status: 'skip', message, fix: '' })
export const warn = (message, fix) => ({ status: 'warn', message, fix })
export const fail = (message, fix) => ({ status: 'fail', message, fix })

/** 목록을 출력용 한 줄로 잇는다. 길면 앞의 몇 개만 보이고 나머지는 수로 알린다. */
export function joinShort(items, limit = 5) {
  const shown = items.slice(0, limit).join(', ')
  return items.length > limit ? `${shown} (+${items.length - limit})` : shown
}
