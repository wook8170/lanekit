# kit — 게이트 실행기와 검사

프로젝트의 `scripts/lanekit/` 로 복사되는 폴더다. 프로젝트는 `node scripts/lanekit/gate.mjs` 로 게이트를 돌린다. 이 폴더의 코드는 Node 22 의 내장 모듈만 쓴다.

## 들어오는 곳과 순서

`gate.mjs` 의 `runGate` 가 유일한 진입 함수다. 한 번의 실행은 아래 순서로 간다.

| 순서 | 하는 일 | 파일 |
|---|---|---|
| 1 | 저장소 루트의 `lanekit.config.json` 을 찾아 읽고 스키마에 견준다 | `lib/config.mjs` · `lib/schema.mjs` |
| 2 | 등록표의 검사 파일과 켠 모듈의 폴더를 읽는다 | `lib/registry.mjs` |
| 3 | 인자를 「돌리기 · 재잠금 · 목록」 명령으로 바꾼다 | `lib/args.mjs` |
| 4 | 프로필 · `--only` · `--skip` · 모드로 돌릴 검사를 고른다 | `lib/profile.mjs` |
| 5 | 검사를 하나씩 돌리고 반환값을 계약의 모양으로 맞춘다 | `lib/runner.mjs` |
| 6 | 모드 규칙으로 통과 · 실패를 정한다 | `lib/verdict.mjs` · `lib/baseline.mjs` |
| 7 | 증거 파일을 쓰고 결과를 출력한다 | `lib/evidence.mjs` · `lib/report.mjs` |

종료 코드는 0(실패한 검사 없음) · 1(실패한 검사나 거절된 재잠금이 있음) · 2(설정이나 사용법 오류)다.

## 검사의 계약

검사는 찾은 것만 알린다. 통과 · 실패는 실행기가 모드로 정한다. 견본은 `checks/guidance/run.mjs` 다.

```js
export const meta = {
  id: 'guidance',                      // 설정 키 checks.<id> 와 같다. 등록표(lib/registry.mjs)의 ID 와도 같다
  profiles: ['light', 'changed', 'full'],
  defaultMode: 'warn',                 // lib/schema.mjs 의 기본 모드와 같게 둔다
  ratchetable: true,                   // 기준선을 쓰는 검사인가
  // afterEvidence: true               // 증거 파일을 쓴 뒤에 돌아야 하는 검사만 적는다
}

export async function run(ctx) { … }
```

`ctx` 의 칸은 다음과 같다.

| 칸 | 내용 |
|---|---|
| `root` | 프로젝트 루트의 절대 경로 |
| `config` | 기본값이 채워진 설정 전체. 검사는 `ctx.config.checks[<id>]` 를 읽는다 |
| `mode` | 이 검사의 모드: `warn` · `ratchet` · `fail` |
| `profile` | `light` · `changed` · `full`. 재잠금 때는 `full` 이다 |
| `changedFiles` | `changed` 프로필에서 기준 브랜치와 갈라진 뒤 바뀐 파일의 목록. 그 밖의 프로필이거나 기준을 찾지 못하면 `null` 이고, 전체를 본다 |
| `baseline` | 잠긴 기준선의 값 `{ 규칙: { 파일: 수 } }`. 없으면 `null` 이다. 허용 폭을 계산할 때 쓴다 |
| `git` | `lib/git.mjs` 의 도우미: `isRepo` · `head` · `isDirty` · `dirtyState` · `trackedFiles` · `untrackedFiles` · `changedFiles` · `listPaths` · `tags` · `run` · `tryRun`. 경로 목록은 `listPaths` 로 받는다(NUL 구분이라 따옴표 · 탭이 든 이름도 그대로 온다) |
| `t` | 메시지 함수 `t(key, vars)`. 검사 파일과 같은 폴더의 `messages.<언어>.json` 이 공통 메시지보다 먼저다 |
| `modules` | 켠 모듈의 폴더 `{ 이름: 절대 경로 }` |
| `evidencePath` | `afterEvidence` 검사만 받는다. 방금 쓴 증거 파일의 경로이고, `--no-evidence` 면 `null` 이다 |
| `relock` | 재잠금(`--relock`)으로 불렸으면 `true` 다. 프로필 실행에서는 `false` 다 |

반환값은 다섯 칸이다. `relockValues`(재잠금 때만 쓴다)와 `unverified`(건너뛸 때만 쓴다)는 선택이다.

| 칸 | 내용 |
|---|---|
| `status` | `pass` · `findings` · `skip` · `error` |
| `summary` | 한 줄 요약 |
| `findings` | `[{ file, line, rule, message, value, limit }]`. 파일 단위로 찾은 것은 `line` 을 `null` 로 둔다 |
| `metrics` | 지표 이름과 수. 증거 파일에 들어간다 |
| `current` | 기준선과 견줄 값 `{ 규칙: { 파일: 수 } }`. 함수 단위 지표의 키는 `파일#함수이름` 이다. 찾은 것이 없는 규칙도 빈 객체로 넣는다 |
| `unverified` | 선택. `status` 가 `skip` 일 때만 본다. 볼 것이 없어서가 아니라 도구가 없거나 결과를 얻지 못해 건너뛰면 `true` 로 둔다. 판정 사유가 `check-unverified` 가 되어 출력과 증거 파일에 경고로 남는다 |
| `relockValues` | 선택. `ctx.relock` 일 때 기준선에 쓸 값이다. 재잠금의 판정은 `current` 로 하고, 이 칸이 있으면 기준선에는 이 값을 쓴다. 없으면 `current` 를 쓴다. `structure` 가 이름이 바뀐 함수의 키를 지금 이름으로 적는 데 쓴다 |

실행기의 판정은 다음과 같다.

| 경우 | 판정 |
|---|---|
| `status` 가 `error` 이거나, 검사가 예외를 던지거나, 검사 파일이 없다 | 모드와 상관없이 실패 |
| `status` 가 `skip` | 건너뜀(통과). `unverified` 가 참이면 프로필과 상관없이 경고로 알린다. 실패는 아니다 |
| 모드 `warn` | 찾은 것을 출력하고 통과 |
| 모드 `fail` | `status` 가 `findings` 이거나 `findings` 가 하나라도 있으면 실패 |
| 모드 `ratchet` | `current` 의 어느 칸이든 기준선보다 늘면 실패. 기준선에 없는 파일은 상한 0, 기준선에 없는 규칙은 알림만 낸다. 기준선이 없으면 종료 코드 2 다 |

검사가 `ConfigError`(`lib/config.mjs`)를 던지면 실패가 아니라 설정 오류(종료 코드 2)로 끝난다. 공개 저장소인데 금지어 목록이 없는 `exposure` 가 이 길을 쓴다.

## 들어 있는 검사

| ID | 폴더 | 하는 일 | 먼저 읽을 파일 |
|---|---|---|---|
| `structure` | `checks/structure/` | TypeScript · JavaScript 소스의 파일과 함수 크기 · 복잡도 · 중첩 · 순환 · 가독성 지표를 잰다. `ts` 모듈을 켜야 돌고, typescript 5 · 6 이 있어야 한다 | `checks/structure/README.md` |
| `docs-drift` | `checks/docs-drift/` | 설정의 `facts` 마다 문서에 적힌 값과 코드에서 센 값을 견준다 | `claims.mjs`(판정) · `sources.mjs`(값을 세는 다섯 가지 방법) |
| `writing` | `checks/writing/` | 문서의 산문 줄에서 금지 표현과 명사 사슬을 찾는다. 래칫의 칸은 「규칙 × 파일」이다 | `scan.mjs` · `rules-ko.mjs` · `rules-en.mjs` |
| `secrets` | `checks/security/` | gitleaks 가 있으면 그것을, 없으면 내장 규칙 여섯 가지로 비밀값의 모양을 찾는다 | `secret-rules.mjs` · `gitleaks.mjs` |
| `audit` | `checks/security/` | 패키지 관리자의 운영 의존성 감사를 돌려 기준 심각도 이상의 권고를 알린다. 잠금 파일이 있는데 결과를 얻지 못하면 어느 프로필에서든 `unverified` 로 건너뛴다(경고) | `audit-rules.mjs` |
| `sbom` | `checks/security/` | 의존성 명세를 `.lanekit/sbom/<커밋>.cdx.json` 에 쓴다 | `sbom.mjs` |
| `provenance` | `checks/security/` | 증거 파일과 SBOM 의 해시가 든 출처 문서를 `.lanekit/evidence/<커밋>-provenance.json` 에 쓴다. 일부만 돌린 실행은 `-provenance-partial.json` 이다 | `provenance.mjs` |
| `exposure` | `checks/exposure/` | 저장소 밖의 금지어 목록으로 추적 중인 파일과 이력을 본다. `full` 프로필은 커밋의 작성자 · 커미터, 태그를 단 사람 · 태그 메시지, 태그와 브랜치의 이름도 본다. 맞은 낱말은 출력하지 않는다 | `denylist.mjs` |
| `guidance` | `checks/guidance/` | 지침 파일의 크기 · 겹치는 절 · 머신에 묶인 경로 · 자기 규칙 위반을 본다 | `rules.mjs` |
| `wiki` | `checks/wiki/` | 문서 검색이 이어져 있는지와 색인이 문서보다 낡았는지를 본다 | `link.mjs` |
| `tests` | `checks/tests/` | 프로젝트의 테스트 명령을 돌리고 종료 코드만 본다 | `run.mjs` |

검사가 함께 쓰는 도우미는 `lib/` 에 있다: `glob.mjs`(글롭 맞추기) · `files.mjs`(볼 파일 목록과 글자 파일 읽기) · `exec.mjs`(외부 명령 실행) · `platform.mjs`(Windows 와 macOS · Linux 가 다른 것: 경로 · 줄바꿈 · 셸 인용 · 설정 폴더) · `history.mjs`(git 이력의 더해진 줄 · 커밋 메시지 · 태그와 브랜치) · `markdown.mjs`(산문 줄 고르기).

`git-hooks/pre-push` 는 init 이 프로젝트의 `.githooks/pre-push` 로 놓는 훅이다. light 프로필 게이트를 돌리고 그 종료 코드로 끝난다. Windows 에서는 Git for Windows 의 sh 가 이 훅을 실행한다. 훅의 줄바꿈은 LF 여야 한다.

`metrics/delivery.mjs` 는 검사가 아니다. `node scripts/lanekit/metrics/delivery.mjs [--tags <글롭>] [--json]` 으로 돌리면 태그에서 구한 배포 빈도 · 리드 타임 중앙값 · 수리 출하 비율의 근삿값을 낸다.

## 기준선 · 재잠금 · 증거 파일

- 기준선은 `scripts/lanekit/baselines/<id>.json`, 재잠금 이력은 같은 폴더의 `relock-log.jsonl` 이다. 이력의 줄마다 잠근 파일별 값 전체(`values`)가 남는다.
- 늘었는지는 파일 단위로 본다. 견주는 대상은 기준선 파일과 이력의 마지막 값 가운데 칸마다 더 작은 쪽이다(`lib/baseline.mjs` 의 `strictestValues`).
- `ratchet` 판정도 이력을 함께 읽는다. 기준선 파일에 이력보다 큰 칸이 있으면 `baseline-unlogged` 로 실패한다(`lib/baseline.mjs` 의 `unloggedIncreases`, `lib/verdict.mjs`). 이력의 마지막 줄에 `values` 가 없으면 `log-without-values` 로 실패한다.
- 재잠금은 사유(`--reason`)가 있어야 한다. 값이 늘면 `--allow-increase --decision <ID>` 가 있어야 하고, `<ID>` 는 `docs/decisions/` 의 파일 이름이다.
- 파일을 옮겼으면 `--moves <json>` 으로 `[{ "from": "…", "to": ["…"] }]` 를 알린다. 묶음의 합이 늘지 않으면 증가로 보지 않는다. 같은 파일이 두 옮김에 나오면 옮김을 쓰지 않고 결정 ID 를 요구한다(`hasOverlappingMoves`).
- `--relock all` 은 대상 검사를 모두 판정한 뒤, 하나도 거절되지 않았을 때만 쓴다. 검사가 스스로 건너뛰면(`skip`) 거절이 아니다. 그 검사만 잠그지 않고 건너뛰었다고 알린다. 검사 ID 를 직접 적었는데 그 검사가 건너뛰면 거절한다.
- 증거 파일은 `.lanekit/evidence/<커밋 앞 12자>-<프로필>.json` 이다. `--only` · `--skip` 으로 일부만 돌린 기록은 `-partial` 이 붙는다. 찾은 것의 본문은 싣지 않고 건수만 싣는다.
- `full` 프로필은 작업 트리에 커밋하지 않은 변경이 있으면 종료 코드 1 로 끝난다(`gate.mjs` 의 `isDirtyRelease`). 상태는 `lib/git.mjs` 의 `dirtyState` 가 읽는다. 저장소 설정과 위치를 바꾸는 `GIT_` 환경 변수(`withoutGitEnv`)의 영향을 받지 않고, `assume-unchanged` · `skip-worktree` 표시가 있는 파일도 dirty 로 본다.
- 게이트와 검사가 쓰는 파일은 `lib/safe-write.mjs` 의 `writeInside` · `appendInside` 로 쓴다. 심볼릭 링크를 따라 저장소 밖에 쓰지 않고, 임시 파일에 쓴 뒤 이름을 바꿔서 하드 링크로 이어진 파일도 건드리지 않는다. 검사를 더할 때도 `writeFileSync` 를 직접 부르지 않는다.

## 검사를 더할 때

1. `lib/registry.mjs` 의 등록표에 적힌 경로에 파일을 둔다. 새 ID 를 더하려면 등록표와 `lib/schema.mjs` 를 함께 고친다.
2. 규칙은 순수 함수로 따로 두고(`rules.mjs`), `run.mjs` 는 「읽기 → 규칙에 넘기기 → 계약의 모양으로 돌려주기」만 한다.
3. 출력 문장은 검사 폴더의 `messages.ko.json` · `messages.en.json` 에 둔다.
4. 테스트는 저장소의 `tests/<이름>.test.mjs` 에 쓴다.
