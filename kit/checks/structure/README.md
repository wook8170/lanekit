# structure — 구조 래칫과 가독성

소스 파일을 TypeScript 컴파일러 API 로 읽어 크기 · 위생 · 가독성 수치를 재고, 상한을 넘은 것을 실행기에 알린다. 통과 · 실패는 실행기가 모드로 정한다(`../../README.md`).

## 들어오는 곳과 순서

`run.mjs` 의 `run(ctx)` 가 유일한 진입 함수다. 재잠금(`--relock structure`) 때도 같은 함수가 불린다.

| 순서 | 하는 일 | 파일 |
|---|---|---|
| 1 | `modules` 에 `ts` 가 있는지 보고, 프로젝트의 `typescript` 를 찾는다. 없으면 건너뛴다 | `typescript.mjs` |
| 2 | 파일 목록에서 설정의 글롭과 확장자로 잴 파일을 고른다 | `source.mjs` |
| 3 | 파일마다 수치를 잰다 | `measure.mjs` · `readable.mjs` |
| 4 | 상한과 견주어 넘은 것만 `{ 규칙: { 키: 수 } }` 로 만든다 | `ratchet.mjs` · `cycles.mjs` |
| 5 | 허용 폭 안의 증가와 이름만 바뀐 함수를 기준선의 칸에 맞춘다 | `relock.mjs` |

## 규칙

키는 파일 단위 규칙이면 파일 경로, 함수 단위 규칙이면 `파일#함수 키` 다. 값이 상한 이하인 파일 · 함수는 싣지 않는다.

| 묶음 | 규칙 | 값 | 상한(설정 키) |
|---|---|---|---|
| 크기 | `fileLines` | 파일 줄 수 | `limits.fileLines` |
| 크기 | `fnLines` | 함수 줄 수 | `limits.fn.fail` · `limits.component.fail` · `routes.route.fail` |
| 크기 | `complexity` · `depth` | 순환 복잡도 · 중첩 깊이 | `limits.complexity` · `limits.depth` |
| 크기 | `componentHooks` | 컴포넌트가 직접 부르는 훅 수 | `limits.componentHooks` |
| 위생 | `emptyCatch` · `console` | 파일 안의 곳 수 | 0 |
| 위생 | `cycles` | 그 파일이 든 순환 묶음의 파일 수 | 0 |
| 가독성 | `paramsOverLimit` | 입력 칸이 상한을 넘는 함수 수 | `readable.maxParams` · `readable.maxProps` |
| 가독성 | `shortIdentifiers` · `historyComments` | 이름 수 · 주석 줄 수 | 0 |
| 가독성 | `missingFileHeader` | 머리 주석이 없으면 1 | 0 |
| 라우트 | `routesPerFile` | 라우트 파일의 라우트 수 | `routes.routesPerFile` |
| 라우트 | `routeDb` · `routeDbIndirect` | 라우트 파일의 DB 호출 수 | 0 |
| 라우트 | `serverTop` | `routes.serverTop` 글롭에 맞는 파일이면 1 | 0 |

- 가독성 묶음은 `readable.enabled` 가 `false` 면 재지 않는다. 라우트 묶음은 `modules` 에 `ts-fastify` 가 있을 때만 잰다.
- `fn.warn` · `component.warn` · `route.warn` 을 넘고 `fail` 이하인 함수는 찾은 것에 넣지 않고, 지표 `fnOverWarn` 에 수만 싣는다.
- 허용 폭(`slack`)은 기준선에 이미 있는 파일 · 함수의 줄 수에만 적용한다. 허용 폭 안에서 늘어난 값은 기준선 값으로 적는다. 그래서 다시 잠가도 허용 폭이 쌓이지 않는다.
- 함수 이름만 바꾼 경우는 같은 파일의 짝 없는 기준선 함수에 맞춘다. 이때 기준선의 키는 옛 이름으로 남는다.
- 파일을 나누거나 옮긴 뒤의 재잠금은 `--moves` 로 짝을 알린다. 새 경로에 머리 주석이 없으면 늘어난 것으로 본다.

## 먼저 읽을 파일

`run.mjs` → `ratchet.mjs`(규칙 표) → `relock.mjs`. 측정 방법이 궁금하면 `measure.mjs` 의 머리 주석을 본다.
