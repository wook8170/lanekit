// 의존성 감사의 판정 — 패키지 관리자마다 다른 감사 결과를 한 모양으로 맞추고, 기준 심각도와 허용 목록으로 가른다. 순수 함수다.
// 부르는 곳: audit.mjs.
// 먼저 읽을 파일: audit.mjs(감사 명령을 돌려 이 함수들에 넘기는 곳).

export const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical']
const DATE = /^\d{4}-\d{2}-\d{2}$/
const ADVISORY_ID = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i

const idFromUrl = (url, fallback) => String(url ?? '').match(ADVISORY_ID)?.[0] ?? String(fallback ?? '')

// pnpm 과 예전 npm 의 모양: { advisories: { <번호>: { module_name, severity, github_advisory_id, url } } }
function fromAdvisories(report) {
  return Object.entries(report.advisories).map(([number, advisory]) => ({
    id: advisory.github_advisory_id ?? idFromUrl(advisory.url, number),
    package: advisory.module_name,
    severity: advisory.severity,
  }))
}

// 지금 npm 의 모양: { vulnerabilities: { <패키지>: { via: [ { source, name, severity, url } | "<패키지>" ] } } }
function fromVulnerabilities(report) {
  const advisories = Object.values(report.vulnerabilities).flatMap((entry) =>
    entry.via.filter((via) => typeof via === 'object').map((via) => ({ id: idFromUrl(via.url, via.source), package: via.name, severity: via.severity })),
  )
  return [...new Map(advisories.map((advisory) => [`${advisory.id} ${advisory.package}`, advisory])).values()]
}

// yarn 의 모양: 한 줄에 JSON 하나. { value: "<패키지>", children: { ID, URL, Severity } }
function fromYarnLines(output) {
  return output
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.children?.Severity)
    .map((entry) => ({ id: idFromUrl(entry.children.URL, entry.children.ID), package: entry.value, severity: entry.children.Severity }))
}

/** 감사 명령의 표준 출력을 [{ id, package, severity }] 로 바꾼다. 읽을 수 없으면 null 이다. */
export function parseAuditOutput(manager, output) {
  try {
    if (manager === 'yarn') return fromYarnLines(output)
    const report = JSON.parse(output)
    if (report.advisories) return fromAdvisories(report)
    if (report.vulnerabilities) return fromVulnerabilities(report)
    return null
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

function describeAllowance(allowed, today) {
  if (!allowed) return 'none'
  if (!DATE.test(allowed.expires)) return 'invalid'
  return allowed.expires < today ? 'expired' : 'active'
}

/**
 * 판정. 기준 심각도(failOn) 이상인 권고만 본다. today 는 `YYYY-MM-DD` 다.
 * 돌려주는 값: blocking(막는 것. allowance 는 none · expired · invalid) · accepted(허용 중) · below(기준 아래 건수).
 */
export function judgeAdvisories({ advisories, allow, failOn, today }) {
  const threshold = SEVERITIES.indexOf(failOn)
  const serious = advisories.filter((advisory) => SEVERITIES.indexOf(advisory.severity) >= threshold)
  const judged = serious.map((advisory) => {
    const allowed = allow.find((entry) => entry.id === advisory.id)
    return { ...advisory, allowance: describeAllowance(allowed, today), expires: allowed?.expires ?? '' }
  })
  return {
    blocking: judged.filter((advisory) => advisory.allowance !== 'active'),
    accepted: judged.filter((advisory) => advisory.allowance === 'active'),
    below: advisories.length - serious.length,
  }
}
