# lanekit

lanekit 은 새 프로젝트에 개발 체계를 한 번에 놓는다. Claude Code 플러그인 두 개와 함께 쓴다.

[English](README.md)

## 세 플러그인의 관계

| 플러그인 | 맡는 일 | 프로젝트에 남는 것 |
|---|---|---|
| **레인키퍼** | 훅으로 규칙을 강제한다: git 안전, 레인, 슬롯, 세션 가드, 출하 관문 | `.lanekeeper/config.json` |
| **wook-skills** | 스킬을 준다: 글쓰기, 문서 위키, 코드 구조 | 없음(스킬은 플러그인에 있다) |
| **lanekit** | 두 플러그인이 가리키는 틀과 게이트를 준다 | `scripts/lanekit/` · `lanekit.config.json` · 지침과 결정 기록의 틀 |

lanekit 은 훅을 두지 않는다. 강제는 레인키퍼가 하고, lanekit 은 레인키퍼 설정의 게이트 명령과 출하 관문에 자기 게이트를 적어 넣는다. 레인키퍼나 wook-skills 가 없는 머신에서도 init 과 게이트는 돈다. 이때 init 은 레인키퍼 연결을 건너뛰고 넣을 값을 제안 폴더에 두며, `/lanekit:doctor` 가 빠진 플러그인을 알린다.

## 하는 일

| 명령 | 하는 일 |
|---|---|
| `/lanekit:init` | 지침 틀 · 결정 기록 틀 · 게이트 스크립트를 프로젝트에 복사한다. 복사한 파일은 그 저장소의 코드가 된다 |
| `/lanekit:doctor` | 25개 항목을 점검한다: 플러그인 설치, 복사본, 게이트 연결, 지침 크기. 아무것도 고치지 않는다 |
| `/lanekit:update` | 복사한 게이트 스크립트를 설치된 버전으로 바꾼다. 프로젝트가 고친 파일은 바꾸지 않고 목록으로 낸다 |

게이트는 lanekit 이 실행하지 않는다. 프로젝트가 `node scripts/lanekit/gate.mjs` 로 실행한다. 그래서 플러그인이 없는 머신과 CI 에서도 같은 게이트가 돈다.

## 설치

lanekit 은 마켓플레이스 `wook8170-plugins` 에 더할 예정이다. 레인키퍼와 wook-skills 가 있는 마켓플레이스다. 등록된 뒤에는 아래 명령으로 설치한다.

```
/plugin install lanekit@wook8170-plugins
```

lanekit 은 레인키퍼와 wook-skills 를 의존 플러그인으로 선언한다. 세 플러그인이 같은 마켓플레이스에 있어야 두 플러그인이 함께 설치된다.

Node 22 이상이 필요하다. 실행 의존성은 없다. macOS · Linux · Windows 를 지원한다. Windows 에서는 Git for Windows 가 있어야 한다. pre-push 훅을 그 안에 든 sh 가 실행하기 때문이다.

## 시작하기

저장소 루트에서 `/lanekit:init` 을 실행한다.

```
/lanekit:init                                         # 다섯 가지를 묻고, 계획을 보여 주고, 확인을 받으면 쓴다
node scripts/lanekit/gate.mjs --profile light         # 게이트 실행
node scripts/lanekit/gate.mjs --relock all --reason "첫 기준선"
/lanekit:doctor
```

놓은 날에는 래칫 검사가 모두 `warn` 모드다. 그래서 기존 코드 때문에 게이트가 막히지 않는다. 기준선을 잠근 뒤 검사를 `ratchet` 으로 올리면, 그때부터 그 값은 줄어들 수만 있다.

## 게이트

| 검사 | 보는 것 |
|---|---|
| `structure` | 파일과 함수의 크기, 복잡도, 중첩, 빈 catch, import 순환, 가독성 지표(TypeScript. `ts-fastify` 모듈을 켜면 라우트 지표도 잰다) |
| `docs-drift` | 문서에 적힌 숫자와 코드에서 센 값 |
| `writing` | 과장 표현 · 비유 · 작업 과정 문구처럼 기계로 확실히 찾을 수 있는 표현 |
| `secrets` · `audit` · `sbom` · `provenance` | 비밀값 스캔, 의존성 감사, SBOM, 출처 문서 |
| `exposure` | 공개 저장소의 금지어 |
| `guidance` | `AGENTS.md` · `CLAUDE.md` 의 크기, 겹치는 절, 머신에 묶인 경로 |
| `wiki` · `tests` | 낡은 문서 색인, 프로젝트의 테스트 명령 |

프로필 셋이 도는 검사를 정한다. `light` 는 웨이브마다와 push 전에, `changed` 는 PR 에서, `full` 은 출하 전에 돌린다. 게이트를 돌릴 때마다 `.lanekit/evidence/` 에 증거 파일이 남는다. 기준선을 다시 잠그려면 사유가 있어야 하고, 값을 늘려 잠그려면 결정 기록이 있어야 한다.

## 끄는 법

| 하고 싶은 것 | 방법 |
|---|---|
| 검사 하나를 끈다 | `lanekit.config.json` 의 `checks.<id>.mode` 를 `off` 로 바꾼다 |
| 스택 모듈 하나를 끈다 | `modules` 에서 뺀다 |
| 한 번만 건너뛴다 | `gate.mjs --skip <id>`. 건너뛴 기록이 증거 파일에 남는다 |
| pre-push 훅을 끈다 | `git config --unset core.hooksPath` |
| lanekit 을 걷어 낸다 | [갱신과 걷어 내기](docs/ko/04-update.md)의 다섯 단계를 따른다 |
| 플러그인만 끈다 | `/plugin disable lanekit`. 복사한 게이트는 프로젝트의 코드라 그대로 돈다 |

환경 변수로 검사를 건너뛰는 길은 없다.

검사가 도구가 없거나 결과를 얻지 못해 스스로 건너뛰면, 어느 프로필에서든 실패가 아니라 경고다. 출력에 `!` 로 표시되고, 증거 파일에는 그 검사의 `reason` 이 `check-unverified` 로, 사유가 `summary` 로 남는다. `lanekit doctor` 의 G5 가 그런 증거를 경고로 알린다.

## 한계

- 출처 문서는 서명이 없는 문서다(SLSA Build L1 수준). 서명과 호스팅 빌드는 프로젝트가 맡는다.
- pre-push 훅과 CI 틀은 주지만, 원격에서 그것을 강제하게 만들 수는 없다. 브랜치 보호는 호스팅에서 설정한다.
- 작성자가 아닌 사람의 승인은 도구가 만들 수 없다. `CODEOWNERS` 틀과 PR 틀의 리뷰 칸까지만 준다.
- 스택 모듈은 TypeScript(`ts`)와 Fastify(`ts-fastify`)만 있다. 다른 스택에서도 `structure` 를 뺀 검사는 모두 돈다.
- Windows 에서 설정에 적은 명령(`checks.tests` · `checks.sbom.command` · `docs-drift` 의 command)은 cmd.exe 가 실행한다. sh 문법(`;` · 작은따옴표 · `$이름`)으로 적은 명령은 Windows 에서 다르게 읽힌다. 두 플랫폼을 함께 쓰는 저장소는 `node 스크립트.mjs` 처럼 두 셸이 같게 읽는 명령을 적는다.

## 문서

- [시작하기](docs/ko/01-start.md)
- [설정](docs/ko/02-config.md)
- [검사와 게이트](docs/ko/03-checks.md)
- [갱신과 걷어 내기](docs/ko/04-update.md)

## 원천

구조 검사는 운영 중인 사내 저장소의 구조 검사에서 옮겼다. 옮기면서 그 저장소에만 맞는 값을 설정으로 바꿨다.

## 라이선스

MIT
