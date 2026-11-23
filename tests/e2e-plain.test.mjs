// 통합 테스트(모듈 없음) — 스택 모듈을 켜지 않은 저장소에서 init 부터 출하 게이트까지를 한 흐름으로 확인한다.
// 대상: lib/init.mjs 가 놓은 복사본의 게이트, guidance 검사의 래칫, 재잠금 통제, 증거 파일.
// 먼저 읽을 파일: e2e-helpers.mjs 의 assertRatchetJourney.
import assert from 'node:assert/strict'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { findExecutable } from '../kit/lib/exec.mjs'
import { assertRatchetJourney, commitAll, runCopiedGate, scaffoldProject } from './e2e-helpers.mjs'

test('모듈 없음: init → light → 잠금 → 지침 위반 → 래칫 실패 → 재잠금 → full', async () => {
  const project = await scaffoldProject({ files: { 'package.json': { name: 'acme-app' } } })
  assert.match(project.applied.output, /- structure: 건너뜀/, '모듈이 없어 건너뛴 structure 가 다른 검사의 잠금을 막지 않는다')
  assertRatchetJourney(project, {
    checkId: 'guidance',
    grownRule: 'absolute-path',
    violate: (dir) => appendFileSync(join(dir, 'AGENTS.md'), '\n개발 서버는 localhost:3000 에서 본다.\n'),
  })
})

// 가짜 gitleaks 로는 실제 규칙이 lanekit 의 파일을 비밀값으로 보는 경우를 알 수 없다. 그래서 설치돼 있으면 실제 것으로 한 번 돌린다.
const realGitleaks = findExecutable('gitleaks')

test('실제 gitleaks 가 있는 머신에서도 놓은 뒤 커밋한 저장소의 light 게이트가 통과한다', { skip: realGitleaks ? false : 'gitleaks 가 설치돼 있지 않다' }, async () => {
  const project = await scaffoldProject({ files: { 'package.json': { name: 'acme-app' } }, bin: { gitleaks: `exec '${realGitleaks}' "$@"` } })
  commitAll(project.dir, 'chore: lanekit init')
  const { code, output } = runCopiedGate(project, ['--profile', 'light'])
  assert.match(output, /secrets\s+fail\s+\S+\s+도구 gitleaks · 찾은 것 0건/)
  assert.equal(code, 0, output)
})
