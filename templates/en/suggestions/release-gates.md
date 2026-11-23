# Checks you can add to the release gate

lanekit does not run static analysis (SAST) or dynamic analysis (DAST). When the project has commands for them, register those commands as they are in `release.gates` of `.lanekeeper/config.json`. The commands below are examples; replace them with the project's own.

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

A gate with `required` set to `true` must pass before a release.
