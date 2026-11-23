# 시작하기

lanekit 은 새 프로젝트에 개발 체계를 한 번에 놓는다. 놓는 것은 지침 틀, 결정 기록 틀, 게이트 스크립트다. 복사한 파일은 그 저장소의 코드가 된다. 그래서 플러그인이 없는 머신과 CI 에서도 같은 게이트가 돈다.

## 필요한 것

- Node 22 이상
- macOS · Linux · Windows. Windows 에서는 Git for Windows 를 쓴다. pre-push 훅을 그 안에 든 sh 가 실행한다
- git 저장소
- 플러그인 레인키퍼(0.2.7 이상)와 wook-skills(0.1.2 이상). lanekit 과 같은 마켓플레이스에서 설치하면 함께 설치된다. 두 플러그인이 없어도 init 은 끝난다. 그 경우 레인키퍼 연결과 위키 연결을 건너뛰고 알린다.

## 놓기

Claude Code 에서 `/lanekit:init` 을 실행한다. 스킬이 다섯 가지를 묻고, 만들 파일의 목록을 보여 준 뒤, 확인을 받으면 쓴다.

| 질문 | 선택지 | 기본값 |
|---|---|---|
| 언어 | `ko` · `en` | 레인키퍼 개인 설정에 값이 있으면 그 값 |
| 프로젝트 종류 | `web-ui` · `service` · `library` · `other` | 의존성으로 감지 |
| 스택 모듈 | `ts` · `ts,ts-fastify` · `none` | `typescript` · `fastify` 의존성으로 감지 |
| 테스트 명령 | 전체 명령과 바뀐 파일만 도는 명령 | `package.json` 의 `test` 스크립트 |
| 원격 관문 | `git-hook` · `github` · `gitlab` · `none` | 원격 주소로 감지 |

터미널에서는 같은 답을 플래그로 넘긴다.

```
lanekit init --lang ko --kind service --modules ts --test-full "npm test" --remote-gate git-hook
lanekit init --lang ko --kind service --modules ts --test-full "npm test" --remote-gate git-hook --yes
```

`--yes` 가 없으면 계획만 보여 주고 아무것도 쓰지 않는다. 더 붙일 수 있는 플래그는 세 가지다.

| 플래그 | 하는 일 |
|---|---|
| `--edit-gitignore` | 이미 있는 `.gitignore` 에 `.lanekit/` 과 `.env` 를 덧붙인다 |
| `--set-hooks-path` | `git config core.hooksPath .githooks` 를 실행해 pre-push 훅을 켠다. 이미 다른 훅 폴더가 설정돼 있으면 바꾸지 않고 알린다 |
| `--lock-baselines` | 지금 값으로 기준선을 잠근다. 모드는 `warn` 그대로다 |

## 만드는 파일

| 파일 | 조건 |
|---|---|
| `lanekit.config.json` | 항상 |
| `scripts/lanekit/` 와 `scripts/lanekit/lanekit.lock.json` | 항상 |
| `AGENTS.md` · `CLAUDE.md` · `progress.md` | 없을 때 |
| `docs/decisions/README.md` · `docs/decisions/0000-template.md` | 없을 때 |
| `docs/memory-guide.md` · `docs/release-checklist.md` | 없을 때 |
| `.lanekeeper/briefs/common.md` | 없을 때 |
| `.githooks/pre-push` | 원격 관문이 `none` 이 아닐 때 |
| `.gitattributes` | 없을 때. 훅과 `scripts/lanekit/` 의 줄바꿈을 LF 로 묶는다. Windows 의 체크아웃이 CRLF 로 바꾸면 sh 가 훅을 읽지 못한다 |
| `.github/workflows/lanekit-gate.yml` · `.github/CODEOWNERS` · `.github/pull_request_template.md` | 원격 관문이 `github` 일 때 |
| `.gitlab/lanekit-gate.gitlab-ci.yml` · `CODEOWNERS` | 원격 관문이 `gitlab` 일 때 |
| `.lanekeeper/config.json` | 없고 레인키퍼가 설치돼 있을 때 |

**이미 있는 파일은 덮어쓰지 않는다.** 내용이 다르면 넣을 내용을 `.lanekit/init-suggestions/<경로>` 에 두고 목록으로 알린다. 그래서 init 을 여러 번 실행해도 결과가 같다.

메모리 폴더에는 쓰지 않는다. 메모리 시작 세트는 `.lanekit/init-suggestions/memory/MEMORY.md` 에 두고, 필요한 항목을 사용자가 옮긴다.

## 놓은 뒤

1. init 이 light 게이트를 한 번 돌려 지금 값을 보여 준다. `secrets` · `audit` · `tests` 만 `fail` 이고 나머지는 `warn` 이다. 그래서 놓은 날에 기존 코드 때문에 게이트가 막히지 않는다.
2. init 이 doctor 를 돌려 연결 상태를 보여 준다.
3. init 은 커밋하지 않는다. 커밋할 경로의 목록만 알린다.
4. 저장소가 공개 저장소면 `lanekit.config.json` 의 `repo.visibility` 를 `public` 으로 바꾼다. 그러면 노출 검사가 필수가 된다.

## 점검

```
lanekit doctor
lanekit doctor --json
```

doctor 는 25개 항목을 보고, 항목마다 상태와 고치는 법 한 줄을 낸다. 아무것도 고치지 않는다. 실패가 있으면 종료 코드가 1 이다.

| 묶음 | 보는 것 |
|---|---|
| P1 ~ P4 | 필요한 플러그인과 버전, 개인 훅에 남은 세션 가드, 레인키퍼의 머신 설정 |
| K1 ~ K6 | 설정 스키마, 복사본과 잠금 파일, 복사본의 버전, 기준선, 재잠금 이력과 손으로 고친 기준선, TypeScript 컴파일러(5 · 6) |
| G1 ~ G5 | 레인키퍼의 게이트 명령과 출하 관문, pre-push 훅, CI 파일, HEAD 의 증거 파일 |
| W1 · W2 · C1 | 문서 검색 연결, 위키 색인, codegraph 색인 |
| I1 ~ I4 | 지침 파일의 크기 · 머신 경로 · 겹치는 절, 메모리 색인의 크기 |
| E1 · S1 · S2 | 공개 저장소의 금지어 목록, gitleaks, `.env` 제외 |

## 세 플러그인의 역할

| 일 | 맡는 곳 |
|---|---|
| 훅으로 막기, 레인 · 슬롯 · 포트, 세션 가드, 출하 관문 표식 | 레인키퍼 |
| 글쓰기 · 문서 위키 · 코드 구조 스킬 | wook-skills |
| init · doctor · update, 게이트 실행기와 검사, 지침 · 결정 · CI 틀 | lanekit |

lanekit 은 Claude Code 훅을 만들지 않는다. `.lanekeeper/config.json` 에 게이트 명령과 출하 관문을 연결할 뿐이다.
