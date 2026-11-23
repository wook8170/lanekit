#!/usr/bin/env node
// 출하 지표 — git 태그에서 배포 빈도 · 리드 타임 중앙값 · 수리 출하 비율의 근삿값을 낸다. 게이트의 검사가 아니다.
// 부르는 곳: 사람이나 CI 가 `node scripts/lanekit/metrics/delivery.mjs [--tags <글롭>] [--json]` 으로 돌린다.
// 먼저 읽을 파일: delivery-math.mjs(계산식).
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { createGit } from '../lib/git.mjs'
import { createKitTranslator } from '../lib/messages.mjs'
import { isEntryScript } from '../lib/platform.mjs'
import { summarizeDelivery } from './delivery-math.mjs'

const METRICS_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_TAGS = 'v*'
const FIELD_END = '\t'

/** 태그를 만든 시각 순서로 읽는다: [{ name, at }]. 주석 태그는 태그 시각, 가벼운 태그는 커밋 시각이다. */
function readTags(git, tagGlob) {
  const format = `--format=%(refname:short)${FIELD_END}%(creatordate:iso-strict)`
  const output = git.tryRun(['for-each-ref', '--sort=creatordate', format, `refs/tags/${tagGlob}`]) ?? ''
  return output.split('\n').filter(Boolean).map((line) => {
    const [name, at] = line.split(FIELD_END)
    return { name, at }
  })
}

/** 태그마다 앞 태그 뒤에 새로 든 커밋의 작성 시각을 붙인다. */
function readReleases(git, tagGlob) {
  return readTags(git, tagGlob).map((tag, index, tags) => {
    const range = index === 0 ? tag.name : `${tags[index - 1].name}..${tag.name}`
    const commitTimes = (git.tryRun(['log', '--format=%aI', range]) ?? '').split('\n').filter(Boolean)
    return { ...tag, commitTimes }
  })
}

const shown = (value, translate) => (value === null ? translate('delivery.unknown') : String(value))

function formatSummary(summary, tagGlob, translate) {
  return [
    translate('delivery.header', { tags: tagGlob, releases: summary.releases, days: summary.periodDays }),
    `  ${translate('delivery.frequency', { value: shown(summary.releasesPer30Days, translate) })}`,
    `  ${translate('delivery.lead-time', { value: shown(summary.leadTimeMedianHours, translate) })}`,
    `  ${translate('delivery.patch-ratio', { value: shown(summary.patchReleaseRatio, translate) })}`,
    translate('delivery.caveat'),
    '',
  ].join('\n')
}

function readLang(root) {
  return root ? loadConfig(root).lang : 'ko'
}

/** 진입 함수. 종료 코드를 돌려준다: 0 정상 · 2 git 저장소가 아니다. */
export function runDelivery({ argv, cwd, write, now = new Date().toISOString() }) {
  const { values } = parseArgs({ args: argv, options: { tags: { type: 'string' }, json: { type: 'boolean' } } })
  const root = findRoot(cwd)
  const translate = createKitTranslator(readLang(root), [METRICS_DIR])
  const git = createGit(root ?? cwd)
  if (!git.isRepo()) {
    write(`${translate('delivery.not-a-repo')}\n`)
    return 2
  }
  const tagGlob = values.tags ?? DEFAULT_TAGS
  const summary = summarizeDelivery({ releases: readReleases(git, tagGlob), now })
  write(values.json ? `${JSON.stringify({ tags: tagGlob, ...summary }, null, 2)}\n` : formatSummary(summary, tagGlob, translate))
  return 0
}

if (isEntryScript(process.argv[1], import.meta.url)) {
  process.exitCode = runDelivery({ argv: process.argv.slice(2), cwd: process.cwd(), write: (text) => process.stdout.write(text) })
}
