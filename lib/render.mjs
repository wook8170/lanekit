// 틀의 자리표시 채우기 — {{이름}} 을 값으로 바꾼다. 값이 없는 자리표시는 오류로 알려, 틀에 자리표시가 남지 않게 한다.
// 부르는 곳: init-plan.mjs(틀을 프로젝트 파일의 내용으로 바꿀 때).
// 먼저 읽을 파일: template-map.mjs(어느 틀이 어느 파일이 되는지).

const PLACEHOLDER = /\{\{([a-z_]+)\}\}/g

/** 틀에 든 자리표시의 이름 목록. */
export const listPlaceholders = (source) => [...new Set([...source.matchAll(PLACEHOLDER)].map((match) => match[1]))]

/** 순수 함수. 값이 없는 자리표시가 있으면 던진다. */
export function renderTemplate(source, values) {
  const unknown = listPlaceholders(source).filter((name) => values[name] === undefined)
  if (unknown.length > 0) throw new Error(`template placeholder without a value: ${unknown.join(', ')}`)
  return source.replace(PLACEHOLDER, (_, name) => String(values[name]))
}
