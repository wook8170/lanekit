# 갱신과 걷어 내기

## 갱신

`scripts/lanekit/` 은 복사본이다. lanekit 플러그인을 올려도 복사본은 그대로다. 복사본은 `lanekit update` 로 바꾼다.

```
lanekit update            # 계획만 보여 준다
lanekit update --yes      # 바꾼다
lanekit update --yes --force checks/guidance/run.mjs
lanekit update --yes --force all
```

`scripts/lanekit/lanekit.lock.json` 에 복사한 파일마다의 sha256 이 있다. update 는 이 해시로 「원본 그대로」와 「프로젝트가 고침」을 가른다.

| 파일의 상태 | update 가 하는 일 |
|---|---|
| 원본 그대로이고 새 원본과 다르다 | 새 원본으로 바꾼다 |
| 새 원본과 이미 같다 | 그대로 둔다 |
| 프로젝트가 고쳤다 | 바꾸지 않고 목록으로 낸다. 새 원본은 `.lanekit/update-suggestions/` 에 둔다 |
| 프로젝트가 고쳤고 `--force` 로 지정했다 | 새 원본으로 덮어쓴다 |
| 복사본에서 빠져 있다 | 다시 놓는다 |
| 새 버전에 새로 생겼다 | 더한다 |
| 새 버전에서 빠졌고 원본 그대로다 | 지운다 |
| 새 버전에서 빠졌는데 프로젝트가 고쳤다 | 남기고 목록으로 낸다 |

쓰거나 지울 경로가 심볼릭 링크이거나 링크를 거쳐 저장소 밖을 가리키면, update 는 그 경로를 알리고 아무것도 바꾸지 않은 채 종료 코드 2 로 끝난다. 링크를 실제 파일이나 폴더로 바꾼 뒤 다시 실행한다.

update 가 건드리지 않는 것은 다음과 같다.

- 기준선과 재잠금 이력(`scripts/lanekit/baselines/`)
- `lanekit.config.json`
- init 이 틀로 놓은 파일(`AGENTS.md` · `progress.md` · 결정 기록 · CI 파일). 이 파일들은 놓은 뒤로 프로젝트의 것이다.

새 버전이 지표를 더하면 기준선에 그 규칙이 없다. 게이트는 이 경우를 실패가 아니라 알림으로 낸다. 사유를 적어 다시 잠그면 알림이 없어진다.

갱신한 뒤에는 `node scripts/lanekit/gate.mjs --profile light` 와 `lanekit doctor` 를 돌려 확인한다.

## 복사본을 고쳐야 할 때

복사본을 직접 고치면 update 가 그 파일을 건너뛴다. 그러면 그 파일은 새 버전의 수정을 받지 못한다. 그래서 프로젝트의 사정은 먼저 `lanekit.config.json` 으로 표현한다. 설정으로 안 되는 요구는 lanekit 저장소에 설정 키를 더해 달라고 알린다.

## 걷어 내기

1. `git config --unset core.hooksPath` 로 git 훅을 끈다.
2. `.lanekeeper/config.json` 에서 세 곳을 뺀다: `gate.command`, `code_standards.checks` 의 게이트 줄, `release.gates` 의 `lanekit-full`.
3. CI 파일을 지운다: `.github/workflows/lanekit-gate.yml` 또는 `.gitlab/lanekit-gate.gitlab-ci.yml` 과 `.gitlab-ci.yml` 의 `include` 줄.
4. `scripts/lanekit/` · `lanekit.config.json` · `.githooks/pre-push` 를 지운다.
5. `.gitignore` 의 `.lanekit/` 줄과 `.lanekit/` 폴더를 지운다.

`AGENTS.md` · `docs/decisions/` 같은 틀에서 온 파일은 프로젝트의 문서라 남겨도 된다. 다만 `AGENTS.md` 의 「게이트」 절은 고친다.
