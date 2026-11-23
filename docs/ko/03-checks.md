# 검사와 게이트

게이트는 프로젝트가 실행한다. lanekit 플러그인이 없어도 돈다.

```
node scripts/lanekit/gate.mjs [--profile light|changed|full] [--only <id,…>] [--skip <id,…>] [--base <ref>]
node scripts/lanekit/gate.mjs --relock <id|all> --reason "<사유>" [--allow-increase --decision <ID>]
node scripts/lanekit/gate.mjs --list
```

종료 코드는 셋이다. 실패한 검사가 없으면 0, 있으면 1, 설정이나 인자가 틀리면 2 다.

## 프로필

| 프로필 | 언제 | 도는 검사 |
|---|---|---|
| `light` | 웨이브마다, push 전(pre-push 훅) | `structure` · `docs-drift` · `writing` · `secrets` · `exposure` · `guidance` · `wiki` |
| `changed` | PR | light 의 검사와 `tests`(바뀐 파일 명령) |
| `full` | 출하 전 | 모든 검사. `tests` 는 전체 명령으로 돌고 `audit` · `sbom` · `provenance` 가 더 돈다 |

## 검사

| ID | 보는 것 | 기본 mode |
|---|---|---|
| `structure` | 파일 줄 수, 함수 길이, 복잡도, 중첩, 빈 catch, `console`, import 순환, 가독성 지표. `ts-fastify` 모듈을 켜면 라우트 지표도 잰다 | `warn` |
| `docs-drift` | 문서에 적힌 숫자와 코드에서 센 값의 차이 | `warn` |
| `writing` | 과장 표현, 비유, 작업 과정 문구, 통용 용어를 바꿔 쓴 낱말, 의인화, 길게 이어진 명사 | `warn` |
| `secrets` | 추적 중인 파일의 비밀값. gitleaks 가 있으면 쓰고, 없으면 내장 규칙 6종으로 본다 | `fail` |
| `exposure` | 공개 저장소에 들어가면 안 되는 낱말. 금지어 목록은 저장소 밖에 둔다 | 공개 저장소 `fail`, 그 밖 `off` |
| `guidance` | 지침 파일의 크기, 겹치는 절, 머신에 묶인 경로, 지침이 자기 글쓰기 규칙을 어긴 줄 | `warn` |
| `wiki` | 문서 검색 연결과 위키 색인의 낡음 | `warn` |
| `tests` | 프로젝트의 테스트 명령의 종료 코드 | `fail` |
| `audit` | 운영 의존성의 취약점. 잠금 파일이 없으면 건너뛴다. 잠금 파일이 있는데 감사 결과를 얻지 못하면(레지스트리에 닿지 못함 · 패키지 관리자 없음) 어느 프로필에서든 경고로 건너뛰고 사유를 증거 파일에 남긴다 | `fail` |
| `sbom` | SBOM(CycloneDX) 만들기 | `warn` |
| `provenance` | 출처 문서 만들기 | `warn` |

## 경고에서 래칫으로

1. 놓은 직후에는 모든 래칫 검사가 `warn` 이다. 찾은 것을 보여 주기만 한다.
2. 지금 값을 기준선으로 잠근다.
   ```
   node scripts/lanekit/gate.mjs --relock structure --reason "첫 기준선"
   ```
3. `lanekit.config.json` 에서 그 검사의 `mode` 를 `ratchet` 으로 바꾼다. 이때부터 값이 늘면 게이트가 실패한다. 이미 있던 위반은 그대로 통과한다. 게이트는 기준선 파일을 재잠금 이력과 함께 읽는다. 기준선 파일에 이력보다 큰 값이 있으면, 지금 값이 그 안에 들어도 실패한다. 그래서 기준선은 손으로 올리지 않고 `--relock` 으로만 바꾼다. 손으로 낮춘 기준선은 그대로 쓴다.
4. 위반을 줄였으면 다시 잠근다. 줄어든 값이 새 상한이 된다.

## 재잠금 통제

- `--reason` 이 없으면 거절한다.
- 값이 늘어나는 재잠금은 `--allow-increase --decision <ID>` 가 있어야 한다. `<ID>` 는 `docs/decisions/` 의 파일 이름이고, 내용이 있는 그 파일이 없으면 거절한다. `README` · 틀 파일 · 공백만 든 파일 · 심볼릭 링크는 결정으로 받지 않는다.
- 늘었는지는 파일 단위로 본다. 한 파일을 줄이고 다른 파일을 늘려 합계가 같아도, 늘어난 파일이 하나라도 있으면 증가다. 견주는 대상은 기준선 파일과 재잠금 이력의 마지막 값 가운데 파일마다 더 작은 쪽이다. 그래서 기준선 파일을 지우거나 손으로 올려도 같은 통제를 받는다.
- 파일을 옮겼으면 `--moves <json>` 으로 짝을 알린다. 옮긴 묶음의 합이 늘지 않으면 증가로 보지 않는다. 같은 파일이 두 옮김에 나오면(`from` 이나 `to`) 그 목록을 쓰지 않고 파일마다 견주며, 결정 ID 가 있어야 잠근다. 옮김을 적은 재잠금에서 규칙의 합계가 늘어도 증가다.
- `--relock all` 에서 스스로 건너뛴 검사(예: 모듈을 켜지 않은 `structure`)는 잠그지 않고 건너뛰었다고 알린다. 나머지 검사는 잠근다. 검사 ID 를 직접 적었는데 그 검사가 건너뛰면 거절한다.
- 재잠금마다 `scripts/lanekit/baselines/relock-log.jsonl` 에 한 줄이 남는다. 줄에는 사유 · 결정 ID · 규칙별 합계와 잠근 파일별 값 전체가 들어 있다. `lanekit doctor` 의 K5 가 사유 없는 줄, 결정 없는 증가, 파일별 값이 이력의 마지막 줄과 다른 기준선 파일을 찾는다.
- 이력의 마지막 줄에 파일별 값(`values`)이 없으면 그 줄로는 견줄 수 없다. `ratchet` 모드의 게이트는 실패하고, 재잠금은 `--allow-increase --decision <ID>` 가 있어야 받아들인다.
- 재잠금 이력의 줄을 손으로 고치거나 더하는 것은 lanekit 이 막지 못한다. 기준선과 이력을 커밋해 두고, 바뀐 내용을 리뷰에서 확인한다. 이력을 지우면 `ratchet` 모드의 게이트는 실패한다.

## 증거 파일

게이트를 돌릴 때마다 `.lanekit/evidence/<커밋 앞 12자>-<프로필>.json` 이 남는다. 커밋, 작업 트리가 깨끗한지(`dirty`), 검사마다의 모드 · 상태 · 판정 · 지표, 건너뛴 검사와 이유가 들어 있다.

- `--only` · `--skip` 으로 일부만 돌린 기록은 `-partial` 이 붙은 파일에 남는다. 온전한 증거를 덮어쓰지 않는다.
- 출하에는 `dirty` 가 `false` 이고 건너뛴 검사가 없는 full 증거를 쓴다. `full` 프로필은 커밋하지 않은 변경이 있으면 검사가 모두 통과해도 종료 코드 1 로 끝난다. `--only` · `--skip` · `--no-evidence` 를 붙여도 같다.
- `dirty` 는 저장소 설정과 환경 변수에 따라 달라지지 않는다. 추적하지 않는 파일은 `status.showUntrackedFiles` 설정과 상관없이 센다. `assume-unchanged` 나 `skip-worktree` 표시가 있는 파일이 하나라도 있으면 `dirty` 다. 그런 파일은 고쳐도 git 이 알리지 않기 때문이다. sparse checkout 을 쓰는 저장소는 이 표시가 늘 있어서 full 프로필이 통과하지 않는다. 게이트가 부르는 git 에는 저장소 · 작업 트리 · 인덱스의 위치를 바꾸는 환경 변수(`GIT_DIR` · `GIT_WORK_TREE` · `GIT_INDEX_FILE` · `GIT_OBJECT_DIRECTORY` · `GIT_ALTERNATE_OBJECT_DIRECTORIES` · `GIT_COMMON_DIR`)를 넘기지 않는다. `GIT_CONFIG_*` 는 그대로 넘기므로 CI 에서 `safe.directory` 를 이 변수로 넣어도 된다. 판정에 쓰는 설정은 명령마다 `-c` 로 고정한다.
- 증거 파일 · SBOM · 출처 문서 · 테스트 기록 · 기준선 · 재잠금 이력은 저장소 안에만 쓴다. 쓸 자리가 심볼릭 링크이거나 링크를 거쳐 저장소 밖을 가리키면 쓰지 않는다. 쓸 때는 임시 파일에 쓴 뒤 이름을 바꾼다. 그래서 하드 링크로 이어진 다른 파일의 내용은 바뀌지 않는다. 증거 파일과 기준선이 그렇게 막히면 게이트는 종료 코드 2 로 끝나고, 검사의 기록 파일이 막히면 그 검사가 실패한다. `--json <파일>` 은 사용자가 적은 경로에 그대로 쓴다.
- `lanekit doctor` 의 G5 는 `dirty` 가 `true` 이거나 실패한 검사가 있는 증거를 세지 않는다.
- 일부만 돌린 실행의 출처 문서는 `<커밋>-provenance-partial.json` 에 남는다.
- 검사가 도구가 없거나 결과를 얻지 못해 건너뛰면 실패가 아니라 경고다. 증거 파일의 그 검사에 `reason: check-unverified` 와 사유(`summary`)가 남는다. `lanekit doctor` 의 G5 는 그런 증거를 출하 증거로 세되 경고로 알린다. 출하 전에 그 사유를 받아들일지는 사람이 정한다.
- 폐쇄망에서는 `audit` 가 레지스트리에 닿지 못해 위의 경고로 건너뛴다. 감사를 다른 곳에서 한다는 것을 미리 밝히려면 `--skip audit` 로 돌린다. 건너뛴 기록이 증거 파일에 남는다.
- 출처 문서는 서명이 없는 문서(SLSA Build L1 수준)다. 서명과 호스팅 빌드는 프로젝트가 맡는다.

## 원격에서 강제하기

| 수단 | 놓는 파일 | 한계 |
|---|---|---|
| git 훅 | `.githooks/pre-push` | 복제본마다 `git config core.hooksPath .githooks` 를 한 번 해야 한다. 건너뛸 수 있다. Windows 에서 훅을 처음 올릴 때는 `git add --chmod=+x .githooks/pre-push` 를 쓴다. 그래야 macOS · Linux 복제본에서 훅이 돈다 |
| GitHub Actions | `.github/workflows/lanekit-gate.yml` | 브랜치 보호에서 이 검사를 필수로 지정해야 머지가 막힌다 |
| GitLab CI | `.gitlab/lanekit-gate.gitlab-ci.yml` | 루트 `.gitlab-ci.yml` 에 `include` 한 줄을 더해야 돈다 |

작성자가 아닌 사람의 승인은 lanekit 이 만들 수 없다. `CODEOWNERS` 틀과 PR 틀의 「리뷰 방식」 칸까지만 준다.
