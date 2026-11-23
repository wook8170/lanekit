# acme-app

lanekit 테스트가 쓰는 가상 프로젝트다. 지침 파일 두 개에는 `guidance` 검사가 잡아야 하는 위반을 일부러 넣었다.

| 파일 | 넣은 위반 |
|---|---|
| `CLAUDE.md` | 줄 수 상한(6줄) 초과, `AGENTS.md` 와 같은 제목의 절 |
| `AGENTS.md` | 바이트 상한(600) 초과, 머신에 묶인 경로와 주소, 억지로 옮긴 용어 |

`src/` 의 TypeScript 파일에는 `structure` 검사가 잡아야 하는 것을 넣었다. 상한은 테스트가 작게 잡는다(`tests/structure-measure.test.mjs`).

| 파일 | 넣은 것 |
|---|---|
| `src/orders/service.ts` | 복잡도 5 · 중첩 3 · 13줄인 함수 `sumOrder`, 빈 catch 1곳, `console` 1곳, `report.ts` 와 서로 가져오는 순환 |
| `src/orders/report.ts` | `service.ts` 와 서로 가져오는 순환 |
| `src/orders/format.ts` | 머리 주석 없음, 매개변수 8개인 함수, 짧은 이름 2개, 이력 주석 1줄 |
| `src/routes/orders.ts` | 라우트 2개, DB 직접 호출 1곳, 앱 객체를 거친 DB 호출 1곳 |
| `src/orders/types.ts` · `src/index.mjs` | 걸리는 것 없음 |
