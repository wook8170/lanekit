// 출하 지표 테스트 — 태그가 있는 가상 저장소에서 배포 빈도 · 리드 타임 중앙값 · 수리 출하 비율을 본다.
// 대상: kit/metrics/delivery.mjs · delivery-math.mjs.
// 먼저 읽을 파일: ../kit/metrics/delivery-math.mjs(계산식).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { isPatchTag, median, summarizeDelivery } from '../kit/metrics/delivery-math.mjs'
import { runDelivery } from '../kit/metrics/delivery.mjs'
import { makeProject, makeTempDir, writeFiles } from './helpers.mjs'

const IDENTITY = ['-c', 'user.name=acme', '-c', 'user.email=dev@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false']

/** 날짜를 정해 git 명령을 돌린다. 커밋의 작성 시각과 주석 태그의 시각이 이 값이 된다. */
function gitAt(dir, date, ...args) {
  const env = { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
  return execFileSync('git', [...IDENTITY, ...args], { cwd: dir, encoding: 'utf8', env })
}

function commitAt(dir, date, file) {
  writeFiles(dir, { [file]: `${date}\n` })
  gitAt(dir, date, 'add', '-A')
  gitAt(dir, date, 'commit', '-q', '-m', file)
}

// 출하 세 번. 리드 타임(시간): v1.0.0 = 48 · 24, v1.0.1 = 12, v1.1.0 = 72 · 6 → 중앙값 24.
function releasedProject() {
  const dir = makeProject({}, {})
  gitAt(dir, '2026-01-01T00:00:00Z', 'init', '-q', '-b', 'main')
  commitAt(dir, '2026-01-01T00:00:00Z', 'a.txt')
  commitAt(dir, '2026-01-02T00:00:00Z', 'b.txt')
  gitAt(dir, '2026-01-03T00:00:00Z', 'tag', '-a', 'v1.0.0', '-m', 'first')
  commitAt(dir, '2026-01-10T12:00:00Z', 'c.txt')
  gitAt(dir, '2026-01-11T00:00:00Z', 'tag', '-a', 'v1.0.1', '-m', 'fix')
  commitAt(dir, '2026-01-20T00:00:00Z', 'd.txt')
  commitAt(dir, '2026-01-22T18:00:00Z', 'e.txt')
  gitAt(dir, '2026-01-23T00:00:00Z', 'tag', '-a', 'v1.1.0', '-m', 'feature')
  gitAt(dir, '2026-01-23T00:00:00Z', 'tag', '-a', 'nightly-7', '-m', 'not a release')
  return dir
}

function deliver(dir, argv) {
  let output = ''
  const code = runDelivery({ argv, cwd: dir, write: (text) => { output += text }, now: '2026-03-04T00:00:00Z' })
  return { code, output }
}

test('태그가 있는 저장소에서 세 지표를 낸다', () => {
  const { code, output } = deliver(releasedProject(), ['--json'])
  assert.equal(code, 0)
  assert.deepEqual(JSON.parse(output), {
    tags: 'v*',
    releases: 3,
    periodDays: 60,
    releasesPer30Days: 1.5,
    leadTimeMedianHours: 24,
    patchReleaseRatio: 0.33,
  })
})

test('사람이 읽는 출력에 근삿값이라는 점과 변경 실패율이 아니라는 점을 적는다', () => {
  const { output } = deliver(releasedProject(), [])
  assert.match(output, /출하 지표 · 태그 v\* · 출하 3번 · 기간 60일/)
  assert.match(output, /배포 빈도\(30일에 몇 번\): 1\.5/)
  assert.match(output, /리드 타임 중앙값.*: 24/)
  assert.match(output, /수리 출하 비율.*: 0\.33/)
  assert.match(output, /근삿값이다\. 수리 출하 비율은 변경 실패율과 같은 값이 아니고/)
})

test('--tags 로 태그 무늬를 바꾼다. 맞는 태그가 없으면 값을 알 수 없다고 낸다', () => {
  const dir = releasedProject()
  assert.equal(JSON.parse(deliver(dir, ['--tags', 'nightly-*', '--json']).output).releases, 1)
  const none = deliver(dir, ['--tags', 'release-*'])
  assert.match(none.output, /출하 0번/)
  assert.match(none.output, /배포 빈도\(30일에 몇 번\): 알 수 없음/)
})

test('git 저장소가 아니면 2 로 끝난다', () => {
  const { code, output } = deliver(makeTempDir(), [])
  assert.equal(code, 2)
  assert.match(output, /git 저장소가 아니라/)
})

test('계산 함수', () => {
  assert.equal(median([]), null)
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 3, 2]), 2.5)
  assert.equal(isPatchTag('v1.0.1'), true)
  assert.equal(isPatchTag('v1.1.0'), false)
  assert.equal(isPatchTag('app-v2.3.4'), true)
  assert.equal(isPatchTag('nightly-7'), false)
  const releases = [{ name: 'v1.0.0', at: '2026-01-02T00:00:00Z', commitTimes: ['2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z'] }]
  const summary = summarizeDelivery({ releases, now: '2026-01-02T00:00:00Z' })
  assert.equal(summary.leadTimeMedianHours, 24, '태그보다 늦은 커밋 시각은 뺀다')
  assert.equal(summary.releasesPer30Days, null, '기간이 0 이면 빈도를 낼 수 없다')
})
