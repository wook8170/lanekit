# 설정

설정 파일은 저장소 루트의 `lanekit.config.json` 하나다. 적지 않은 키는 기본값을 쓴다. 모르는 키가 있으면 게이트가 설정 오류(종료 코드 2)로 끝난다. 오타 때문에 검사가 조용히 꺼지는 일을 막기 위해서다.

## 전체 모양

```json
{
  "version": 1,
  "lang": "ko",
  "repo": { "visibility": "private" },
  "modules": ["ts"],
  "remote_gate": "git-hook",
  "build": { "command": "" },
  "checks": {
    "structure": { "mode": "warn" },
    "docs-drift": { "mode": "warn", "facts": [] },
    "writing": { "mode": "warn", "globs": ["docs/**/*.md", "README*.md"] },
    "secrets": { "mode": "fail", "tool": "auto" },
    "audit": { "mode": "fail", "failOn": "high" },
    "sbom": { "mode": "warn" },
    "provenance": { "mode": "warn" },
    "exposure": { "mode": "auto" },
    "wiki": { "mode": "warn" },
    "guidance": { "mode": "warn" },
    "tests": { "mode": "fail", "full": "npm test", "changed": "" }
  }
}
```

## 최상위 키

| 키 | 값 | 뜻 |
|---|---|---|
| `lang` | `ko` · `en` | 게이트와 doctor 의 메시지 언어 |
| `repo.visibility` | `private` · `public` | `public` 이면 노출 검사가 `fail` 로 돈다 |
| `modules` | `ts` · `ts-fastify` 의 목록 | 켠 스택 모듈. 비어 있으면 `structure` 검사를 건너뛴다 |
| `remote_gate` | `git-hook` · `github` · `gitlab` · `none` | doctor 가 훅과 CI 파일을 볼지 정한다 |
| `build.command` | 문자열 | 출처 문서에 적을 빌드 명령 |

## 검사의 모드

| mode | 게이트의 판정 |
|---|---|
| `off` | 돌리지 않는다 |
| `warn` | 찾은 것을 출력하고 통과시킨다 |
| `ratchet` | 기준선과 견준다. 어느 「규칙 × 파일」 칸이든 늘었으면 실패다. 기준선에 없는 새 파일의 상한은 0 이다 |
| `fail` | 찾은 것이 하나라도 있으면 실패다 |

`exposure` 의 `auto` 는 공개 저장소에서 `fail`, 그 밖에서 `off` 라는 뜻이다.

## 자주 고치는 칸

| 하고 싶은 것 | 고칠 곳 |
|---|---|
| 테스트 명령을 정한다 | `checks.tests.full` · `checks.tests.changed`. `changed` 의 `{files}` 자리에 바뀐 파일이 들어간다 |
| 재는 소스의 범위를 바꾼다 | `checks.structure.source.include` · `exclude` · `extensions` |
| 크기 상한을 바꾼다 | `checks.structure.limits` |
| 가독성 지표만 끈다 | `checks.structure.readable.enabled` 를 `false` 로 |
| 문서의 숫자를 코드와 견준다 | `checks.docs-drift.facts` |
| 글쓰기 검사의 대상을 바꾼다 | `checks.writing.globs` · `extraBanned` · `allow` |
| 받아들인 취약점을 적는다 | `checks.audit.allow` 에 ID · 사유 · 만료일 |
| 지침 파일의 예산을 바꾼다 | `checks.guidance.maxLines` · `maxBytes` |

칸마다 받는 값은 `scripts/lanekit/lib/schema.mjs` 에 선언돼 있다. `lanekit doctor` 의 K1 이 틀린 키의 경로와 받는 값을 알려 준다.

## 끄는 법

| 하고 싶은 것 | 방법 |
|---|---|
| 검사 하나를 끈다 | `checks.<id>.mode` 를 `off` 로 |
| 모듈 하나를 끈다 | `modules` 에서 뺀다 |
| 한 번만 건너뛴다 | `gate.mjs --skip <id>`. 증거 파일에 `skipped-by-flag` 로 남는다 |
| git 훅을 끈다 | `git config --unset core.hooksPath` |

환경 변수로 검사를 건너뛰는 길은 없다.

검사가 도구가 없거나 결과를 얻지 못해 스스로 건너뛰면, 어느 프로필에서든 실패가 아니라 경고다. 출력에 `!` 로 표시되고, 증거 파일에는 그 검사의 `reason` 이 `check-unverified` 로, 사유가 `summary` 로 남는다. `lanekit doctor` 의 G5 가 그런 증거를 경고로 알린다. 해당하는 경우는 `audit`(패키지 관리자가 없거나 감사 결과를 읽지 못함)와 `structure`(`ts` 모듈을 켰는데 typescript 가 없음)다.

## 레인키퍼와 잇는 값

init 이 `.lanekeeper/config.json` 에 넣는 값이다. 파일이 이미 있으면 고치지 않고, 빠진 칸을 채운 내용을 `.lanekit/init-suggestions/.lanekeeper/config.json` 에 둔다.

```json
{
  "gate": { "command": "node scripts/lanekit/gate.mjs --profile light" },
  "code_standards": {
    "doc": "AGENTS.md#코드-작성-기준",
    "checks": ["node scripts/lanekit/gate.mjs --only structure"]
  },
  "release": {
    "gates": [{ "name": "lanekit-full", "command": "node scripts/lanekit/gate.mjs --profile full", "required": true }]
  },
  "lanes": { "commit": "allowed" },
  "paths": { "lane_reports": ".lanekit/reports/{lane}.md", "decisions": "docs/decisions/{date}-{slug}.md" }
}
```

`lanes.commit` 은 레인키퍼의 값 이름을 그대로 쓴다. `allowed` 는 레인이 자기 브랜치에 커밋한다는 뜻이고, `on-instruction` 은 지시가 있을 때만 커밋한다는 뜻이다.

## 저장소 밖에 두는 것

| 파일 | 내용 |
|---|---|
| `~/.config/lanekit/denylist.txt`(Windows 는 `%APPDATA%\lanekit\denylist.txt`) | 공개 저장소의 금지어 목록. 환경 변수 `LANEKIT_DENYLIST` 로 경로를 바꿀 수 있다 |
| `~/.lanekeeper/machine.json` | 부하 · 슬롯 기준. 레인키퍼의 파일이고 lanekit 은 있는지만 본다 |
