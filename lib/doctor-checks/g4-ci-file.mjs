// G4 — 원격 관문을 CI 로 정한 저장소에 CI 파일이 있고, 그 파일이 게이트 실행기를 부르는지 본다.
// 부르는 곳: index.mjs.
// 먼저 읽을 파일: ../template-map.mjs(init 이 놓는 CI 틀의 경로).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readProjectConfig } from '../project-config.mjs'
import { ok, warn } from './result.mjs'

export const meta = { id: 'G4', title: 'doctor.G4.title' }

const GITLAB_INCLUDE = 'lanekit-gate.gitlab-ci.yml'
const readOrEmpty = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '')

function githubCallsGate(root) {
  const workflowDir = join(root, '.github', 'workflows')
  if (!existsSync(workflowDir)) return false
  const workflows = readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name))
  return workflows.some((name) => readOrEmpty(join(workflowDir, name)).includes('gate.mjs'))
}

// GitLab 은 루트의 .gitlab-ci.yml 만 읽는다. 그 파일이 게이트를 직접 부르거나 lanekit 의 틀을 include 해야 한다.
function gitlabCallsGate(root) {
  const pipeline = readOrEmpty(join(root, '.gitlab-ci.yml'))
  if (pipeline.includes('gate.mjs')) return true
  return pipeline.includes(GITLAB_INCLUDE) && readOrEmpty(join(root, '.gitlab', GITLAB_INCLUDE)).includes('gate.mjs')
}

const CALLS_GATE = { github: githubCallsGate, gitlab: gitlabCallsGate }

export function check(ctx) {
  const remoteGate = readProjectConfig(ctx.root).config.remote_gate
  const callsGate = CALLS_GATE[remoteGate]
  if (!callsGate) return ok(ctx.t('doctor.G4.not-used', { remoteGate }))
  if (callsGate(ctx.root)) return ok(ctx.t('doctor.G4.ok', { remoteGate }))
  return warn(ctx.t('doctor.G4.absent', { remoteGate }), ctx.t(`doctor.G4.fix-${remoteGate}`))
}
