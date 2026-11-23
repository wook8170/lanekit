# lanekit 작업 지침

## 저장소 모양

| 폴더 | 내용 |
|---|---|
| `kit/` | 프로젝트의 `scripts/lanekit/` 로 복사하는 원본이다. 게이트 실행기와 검사가 있다. 먼저 `kit/README.md` 를 읽는다 |
| `lib/` | 플러그인 쪽 코드다. 프로젝트로 복사하지 않는다. `lib/` 는 `kit/` 를 가져다 쓸 수 있고, `kit/` 는 `lib/` 를 가져다 쓰지 않는다 |
| `modules/` | 스택 모듈(`ts` · `ts-fastify`)이다 |
| `skills/` | `/lanekit:init` · `/lanekit:doctor` · `/lanekit:update` 스킬이다. 질문은 스킬이 하고, 답을 `lanekit` 명령의 플래그로 넘긴다 |
| `docs/` | 사용자 문서다. `ko` · `en` 두 벌이고 절 구성이 같다 |
| `templates/` | init 이 프로젝트에 놓는 틀이다. `ko` · `en` 두 벌이다 |
| `tests/` | `node --test` 로 도는 테스트와 가상 프로젝트 `fixtures/acme-app` 이다 |

## 코드 작성 기준

- 실행 의존성은 0개다. Node 22 의 내장 모듈만 쓴다. 파일은 모두 `.mjs` 다.
- 판정과 실행을 나눈다. 판정은 입력을 받아 결과를 돌려주는 순수 함수로 두고, 파일을 쓰는 함수와 섞지 않는다.
- 크기 상한: 파일 500줄, 함수 60줄, 복잡도 15, 중첩 4, 매개변수와 입력 객체의 칸 7개.
- 파일 첫머리에 주석 3줄을 둔다: 맡는 일 · 부르는 곳 · 먼저 읽을 파일.
- 주석에는 무엇과 왜를 쓴다. 버전 번호 · 티켓 번호 같은 이력은 주석에 두지 않는다.
- 한 글자 이름과 약어 이름(`tmp` · `cfg` · `obj` · `val`)을 쓰지 않는다.
- 출력 문장은 코드에 적지 않고 `messages.ko.json` · `messages.en.json` 두 벌에 둔다.
- 빈 `catch` 와 `console` 을 쓰지 않는다. 출력은 넘겨받은 `write` 함수로 한다.

## 테스트

- 기능을 더하거나 고치면 같은 변경에서 `tests/<이름>.test.mjs` 를 고친다.
- 임시 프로젝트는 `tests/helpers.mjs` 의 `makeProject` · `copyFixture` 로 만든다. 저장소 안의 `fixtures/` 를 직접 고치는 테스트는 쓰지 않는다.
- 외부 도구는 가짜 실행 파일로 바꿔 테스트한다.

## 게이트

```
node kit/gate.mjs --list
node kit/gate.mjs --profile light
node --test tests/*.test.mjs
```

## 공개 저장소

이 저장소는 공개를 전제로 쓴다. 제품 · 회사 · 고객의 이름, 내부 경로, 계정 이름, 서버 주소와 비밀값을 코드 · 틀 · 문서 · 테스트 · 커밋 메시지에 넣지 않는다. 예시의 이름은 `acme-app` · `example.com` 을 쓴다.
