// 출하 지표의 계산 — 태그 목록에서 배포 빈도 · 리드 타임 중앙값 · 수리 출하 비율을 구한다. 모두 순수 함수다.
// 부르는 곳: delivery.mjs.
// 먼저 읽을 파일: delivery.mjs(git 에서 태그와 커밋 시각을 읽어 넘기는 곳).

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
const WINDOW_DAYS = 30
const PATCH_TAG = /(\d+)\.(\d+)\.(\d+)(?!.*\d+\.\d+\.\d+)/

const round = (value, digits = 2) => Number(value.toFixed(digits))

export function median(numbers) {
  if (numbers.length === 0) return null
  const sorted = [...numbers].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** 패치 버전 태그인가. 이름 안의 `x.y.z` 에서 z 가 0 보다 크면 수리 출하로 본다. */
export function isPatchTag(name) {
  const version = name.match(PATCH_TAG)
  return version !== null && Number(version[3]) > 0
}

/**
 * 지표 계산. releases 는 시각 순서의 [{ name, at, commitTimes }] 이고 at · commitTimes 는 ISO 시각이다.
 * commitTimes 는 그 태그에 처음 든 커밋의 작성 시각이다. now 는 기간의 끝이다.
 * 모두 근삿값이다. 배포 실패나 복구는 태그만으로 알 수 없다.
 */
export function summarizeDelivery({ releases, now }) {
  if (releases.length === 0) return { releases: 0, periodDays: 0, releasesPer30Days: null, leadTimeMedianHours: null, patchReleaseRatio: null }
  const periodDays = (Date.parse(now) - Date.parse(releases[0].at)) / DAY_MS
  const leadHours = releases.flatMap((release) =>
    release.commitTimes.map((commitTime) => (Date.parse(release.at) - Date.parse(commitTime)) / HOUR_MS).filter((hours) => hours >= 0),
  )
  const leadMedian = median(leadHours)
  return {
    releases: releases.length,
    periodDays: round(periodDays, 1),
    releasesPer30Days: periodDays > 0 ? round((releases.length / periodDays) * WINDOW_DAYS) : null,
    leadTimeMedianHours: leadMedian === null ? null : round(leadMedian, 1),
    patchReleaseRatio: round(releases.filter((release) => isPatchTag(release.name)).length / releases.length),
  }
}
