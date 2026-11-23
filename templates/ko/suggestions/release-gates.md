# 출하 관문에 더할 수 있는 검사

lanekit 은 정적 분석(SAST)과 동적 분석(DAST)을 실행하지 않는다. 프로젝트에 그 명령이 있으면 `.lanekeeper/config.json` 의 `release.gates` 에 그대로 등록한다. 아래 명령은 예시이므로 프로젝트의 명령으로 바꿔 쓴다.

```json
{
  "release": {
    "gates": [
      { "name": "lanekit-full", "command": "node scripts/lanekit/gate.mjs --profile full", "required": true },
      { "name": "sast", "command": "semgrep scan --config auto --error", "required": true },
      { "name": "dast", "command": "npm run test:dast", "required": false }
    ]
  }
}
```

`required` 가 `true` 인 관문은 통과해야 출하할 수 있다.
