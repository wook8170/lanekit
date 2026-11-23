// update 의 판정 — 잠금 파일 · 지금 복사본 · 새 원본의 해시를 견주어 파일마다 할 일을 정한다. 아무것도 쓰지 않는다.
// 부르는 곳: update.mjs.
// 먼저 읽을 파일: lock.mjs(잠금 파일의 모양).

// 쓰는 동작과 지우는 동작. 나머지(current · conflict · orphan · gone)는 복사본을 건드리지 않는다.
export const WRITING_ACTIONS = ['add', 'restore', 'replace', 'overwrite']
export const REMOVING_ACTIONS = ['remove']

// 새 원본에 있는 파일. 프로젝트가 고친 파일은 force 가 없으면 바꾸지 않고 conflict 로 알린다.
function planIncoming({ locked, actual, incoming, isForced }) {
  if (actual === undefined) return locked === undefined ? 'add' : 'restore'
  if (actual === incoming) return 'current'
  if (actual === locked) return 'replace'
  return isForced ? 'overwrite' : 'conflict'
}

// 새 원본에서 빠진 파일. 원본 그대로면 지우고, 프로젝트가 고쳤으면 force 가 없는 한 남긴다.
function planRemoved({ locked, actual, isForced }) {
  if (actual === undefined) return 'gone'
  return actual === locked || isForced ? 'remove' : 'orphan'
}

/**
 * 순수 판정. hashes 는 { locked, actual, incoming } 이고 셋 다 { 상대 경로: sha256 } 이다.
 * force 는 덮어써도 되는 경로 목록이다. 'all' 이 들어 있으면 모든 파일이다.
 * [{ path, action }] 을 경로 이름순으로 돌려준다.
 */
export function planUpdate(hashes, force = []) {
  const paths = [...new Set([...Object.keys(hashes.locked), ...Object.keys(hashes.incoming)])].sort()
  return paths.map((path) => {
    const state = {
      locked: hashes.locked[path],
      actual: hashes.actual[path],
      incoming: hashes.incoming[path],
      isForced: force.includes('all') || force.includes(path),
    }
    return { path, action: state.incoming === undefined ? planRemoved(state) : planIncoming(state) }
  })
}

/** 순수 함수. 동작별 경로 목록 { 동작: [경로] }. */
export function groupByAction(actions) {
  const groups = {}
  for (const { path, action } of actions) groups[action] = [...(groups[action] ?? []), path]
  return groups
}

/** 순수 판정. 복사본이나 잠금 파일을 바꿀 일이 있는가. */
export function hasChanges(actions) {
  return actions.some(({ action }) => WRITING_ACTIONS.includes(action) || REMOVING_ACTIONS.includes(action))
}
