// 틀과 프로젝트 파일의 짝 — templates/<언어>/ 의 어느 파일이 프로젝트의 어느 경로가 되는지, 어느 원격 관문에서 만드는지 적는다.
// 부르는 곳: init-plan.mjs 의 listTargets. 테스트는 두 언어의 틀이 이 표와 맞는지 본다.
// 먼저 읽을 파일: ../templates/ko/(틀의 본문).

export const SUGGESTIONS_DIR = '.lanekit/init-suggestions'

// gates 가 없으면 항상 만든다. 있으면 remote_gate 가 그 값일 때만 만든다.
export const TEMPLATE_TARGETS = [
  { source: 'AGENTS.md', target: 'AGENTS.md' },
  { source: 'CLAUDE.md', target: 'CLAUDE.md' },
  { source: 'progress.md', target: 'progress.md' },
  { source: 'decisions/README.md', target: 'docs/decisions/README.md' },
  { source: 'decisions/0000-template.md', target: 'docs/decisions/0000-template.md' },
  { source: 'briefs/common.md', target: '.lanekeeper/briefs/common.md' },
  { source: 'memory/README.md', target: 'docs/memory-guide.md' },
  { source: 'release-checklist.md', target: 'docs/release-checklist.md' },
  // 훅과 게이트 스크립트의 줄바꿈을 LF 로 묶는다. Windows 의 체크아웃이 CRLF 로 바꾸면 sh 가 훅을 읽지 못한다.
  { source: 'gitattributes', target: '.gitattributes' },
  { source: 'github/workflows/lanekit-gate.yml', target: '.github/workflows/lanekit-gate.yml', gates: ['github'] },
  { source: 'github/CODEOWNERS', target: '.github/CODEOWNERS', gates: ['github'] },
  { source: 'github/pull_request_template.md', target: '.github/pull_request_template.md', gates: ['github'] },
  { source: 'gitlab/lanekit-gate.gitlab-ci.yml', target: '.gitlab/lanekit-gate.gitlab-ci.yml', gates: ['gitlab'] },
  { source: 'github/CODEOWNERS', target: 'CODEOWNERS', gates: ['gitlab'] },
]

// 프로젝트 파일로 놓지 않고 제안 폴더에만 두는 틀. 메모리 시작 세트는 개인 폴더의 파일이라 사용자가 옮긴다.
export const OFFERED_TEMPLATES = [
  { source: 'memory/MEMORY.md', target: `${SUGGESTIONS_DIR}/memory/MEMORY.md` },
  { source: 'suggestions/release-gates.md', target: `${SUGGESTIONS_DIR}/release-gates.md` },
]

export const HOOK_SOURCE = 'git-hooks/pre-push'
export const HOOK_TARGET = '.githooks/pre-push'

const INSTALL_COMMANDS = {
  pnpm: 'corepack enable && pnpm install --frozen-lockfile',
  npm: 'npm ci',
  yarn: 'corepack enable && yarn install --immutable',
}

/** 틀의 자리표시에 넣을 값. 패키지 관리자가 없으면 설치 단계는 아무것도 하지 않는 명령이 된다. */
export function templateValues({ projectName, packageManager }) {
  return { project: projectName, install_command: INSTALL_COMMANDS[packageManager] ?? 'true' }
}
