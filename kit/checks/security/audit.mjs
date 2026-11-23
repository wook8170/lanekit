// 의존성 감사 검사(audit) — 패키지 관리자를 감지해 운영 의존성 감사를 돌리고, 기준 심각도 이상의 권고를 알린다.
// 부르는 곳: gate.mjs(등록표의 audit. full 프로필에서만 돈다).
// 먼저 읽을 파일: audit-rules.mjs(결과 읽기와 판정).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { findExecutable, runTool } from '../../lib/exec.mjs'
import { judgeAdvisories, parseAuditOutput } from './audit-rules.mjs'

export const meta = {
  id: 'audit',
  profiles: ['full'],
  defaultMode: 'fail',
  ratchetable: false,
}

const AUDIT_TIMEOUT_MS = 120_000

// 잠금 파일로 패키지 관리자를 가린다. 앞에 있는 것이 먼저다.
const MANAGERS = [
  { name: 'pnpm', lockFiles: ['pnpm-lock.yaml'], args: ['audit', '--prod', '--json'] },
  { name: 'yarn', lockFiles: ['yarn.lock'], args: ['npm', 'audit', '--environment', 'production', '--json'] },
  { name: 'npm', lockFiles: ['package-lock.json', 'npm-shrinkwrap.json'], args: ['audit', '--omit=dev', '--json'] },
]

export function detectManager(root) {
  return MANAGERS.find((manager) => manager.lockFiles.some((lockFile) => existsSync(join(root, lockFile)))) ?? null
}

// 감사를 돌리지 못하면 프로필과 상관없이 건너뛴다. 감사할 것이 있는데 결과를 얻지 못한 경우는 unverified 로 알려 경고로 보이게 한다.
const skipped = (summary, isUnverified) => ({ status: 'skip', summary, findings: [], metrics: {}, current: null, unverified: isUnverified })

/**
 * 감사를 돌려 권고 목록을 얻는다. 얻지 못하면 { skipReason } 이다.
 * isUnverified 는 「감사할 것이 있는데 결과를 얻지 못했다」는 뜻이다. 잠금 파일이 없는 경우는 감사할 것이 없으므로 여기에 들지 않는다.
 */
function collectAdvisories(root, translate) {
  const manager = detectManager(root)
  if (!manager) return { skipReason: translate('audit.no-lockfile') }
  const managerFile = findExecutable(manager.name)
  if (!managerFile) return { skipReason: translate('audit.manager-missing', { manager: manager.name }), isUnverified: true }
  // 감사 명령은 찾은 것이 있으면 0 이 아닌 코드로 끝난다. 그래서 종료 코드가 아니라 출력을 읽어 판단한다.
  const outcome = runTool(managerFile, manager.args, { cwd: root, timeoutMs: AUDIT_TIMEOUT_MS })
  const advisories = parseAuditOutput(manager.name, outcome.stdout)
  // 레지스트리에 닿지 못한 경우다(폐쇄망 · 프록시 · 장애). 권고가 없는데 명령이 0 이 아닌 코드로 끝났거나 시간 초과로 죽은 경우도 같다.
  // 권고가 없을 때 감사 명령은 0 으로 끝난다. 그래서 「0건인데 실패 코드」는 결과가 아니라 오류로 본다.
  if (!isAuditReadable(advisories, outcome)) return { skipReason: translate('audit.unreadable', { manager: manager.name }), isUnverified: true }
  return { manager: manager.name, advisories }
}

/**
 * 순수 판정. 감사 결과를 믿을 수 있는가. outcome 은 runTool 이 돌려준 { code, failedToStart } 다.
 * 읽지 못했거나, 권고가 0건인데 명령이 정상으로 끝나지 않았으면 믿지 않는다.
 * 시간 초과나 신호로 죽은 경우에는 그때까지 나온 권고가 있어도 믿지 않는다. 출력이 중간에 잘려 높은 등급의 권고가 빠졌을 수 있다.
 */
export function isAuditReadable(advisories, outcome) {
  if (advisories === null || outcome.failedToStart) return false
  return advisories.length > 0 || outcome.code === 0
}

const blockingFinding = (advisory, manager, translate) => ({
  file: manager,
  line: null,
  rule: advisory.allowance === 'none' ? advisory.severity : `allow-${advisory.allowance}`,
  message: translate(`audit.blocking.${advisory.allowance}`, advisory),
  value: 1,
  limit: 0,
})

/** 검사 계약의 run. 오늘 날짜는 허용 항목의 만료를 가리는 데 쓴다. */
export async function run(ctx) {
  const options = ctx.config.checks.audit
  const collected = collectAdvisories(ctx.root, ctx.t)
  if (collected.skipReason) return skipped(collected.skipReason, Boolean(collected.isUnverified))
  const today = new Date().toISOString().slice(0, 10)
  const judged = judgeAdvisories({ advisories: collected.advisories, allow: options.allow, failOn: options.failOn, today })
  const counts = { blocking: judged.blocking.length, accepted: judged.accepted.length, below: judged.below }
  return {
    status: judged.blocking.length > 0 ? 'findings' : 'pass',
    summary: ctx.t('audit.summary', { manager: collected.manager, failOn: options.failOn, ...counts }),
    findings: judged.blocking.map((advisory) => blockingFinding(advisory, collected.manager, ctx.t)),
    metrics: counts,
    current: null,
  }
}
