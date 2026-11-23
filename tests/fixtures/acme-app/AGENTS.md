# acme-app 작업 지침

## 저장소 모양

- `src/` 에 서비스 코드가 있다.
- `docs/` 에 문서와 결정 기록이 있다.

## 게이트

push 전에 아래 명령을 돌린다.

```
# 단위 시험 뒤에 돌린다(코드 블록 안이라 세지 않는다)
node scripts/lanekit/gate.mjs --profile light
```

인라인 코드 `종단 시험` 도 세지 않는다.

## 테스트

기능을 바꾸면 단위 시험을 같은 변경에서 고친다. 기능 가지에서 작업한 뒤 풀 리퀘스트를 연다.

## 환경

- 작업 폴더는 /Users/alex/work/acme-app 이다.
- 개발 서버는 localhost:3000 에서 뜬다.
- 윈도우에서는 C:\work\acme-app 에 둔다.
