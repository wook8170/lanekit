# Configuration

There is one config file, `lanekit.config.json` at the repository root. Keys you leave out take their defaults. An unknown key ends the gate with a config error (exit code 2), so that a typo cannot silently turn a check off.

## Full shape

```json
{
  "version": 1,
  "lang": "en",
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

## Top-level keys

| Key | Values | Meaning |
|---|---|---|
| `lang` | `ko`, `en` | Language of gate and doctor messages |
| `repo.visibility` | `private`, `public` | With `public`, the exposure check runs as `fail` |
| `modules` | A list of `ts`, `ts-fastify` | Enabled stack modules. When empty, the `structure` check is skipped |
| `remote_gate` | `git-hook`, `github`, `gitlab`, `none` | Decides whether doctor looks at the hook and the CI file |
| `build.command` | Text | The build command recorded in the provenance document |

## Check modes

| mode | Gate verdict |
|---|---|
| `off` | Not run |
| `warn` | Prints findings and passes |
| `ratchet` | Compares with the baseline. Any "rule × file" cell that grew fails. A new file not in the baseline has a limit of 0 |
| `fail` | Fails on any finding |

`auto` for `exposure` means `fail` in a public repository and `off` otherwise.

## Keys you will edit most

| Goal | Where |
|---|---|
| Set the test commands | `checks.tests.full`, `checks.tests.changed`. `{files}` in `changed` receives the changed files |
| Change which sources are measured | `checks.structure.source.include`, `exclude`, `extensions` |
| Change size limits | `checks.structure.limits` |
| Turn off only the readability metrics | Set `checks.structure.readable.enabled` to `false` |
| Compare numbers in documents with code | `checks.docs-drift.facts` |
| Change what the writing check reads | `checks.writing.globs`, `extraBanned`, `allow` |
| Record an accepted vulnerability | `checks.audit.allow` with ID, reason and expiry date |
| Change the guidance budget | `checks.guidance.maxLines`, `maxBytes` |

The accepted values for every key are declared in `scripts/lanekit/lib/schema.mjs`. K1 of `lanekit doctor` reports the path of a wrong key and the values it accepts.

## Turning things off

| Goal | How |
|---|---|
| Turn off one check | Set `checks.<id>.mode` to `off` |
| Turn off one module | Remove it from `modules` |
| Skip once | `gate.mjs --skip <id>`. The evidence file records it as `skipped-by-flag` |
| Turn off the git hook | `git config --unset core.hooksPath` |

No environment variable skips a check.

When a check skips itself because a tool is missing or gave no result, it is a warning in every profile, not a failure. The output marks it with `!`, and the evidence file keeps `check-unverified` as that check's `reason` and the cause in `summary`. G5 of `lanekit doctor` reports such evidence as a warning. This applies to `audit` (no package manager, or an unreadable audit result) and `structure` (the `ts` module is on but typescript is missing).

## Values linked into lanekeeper

init puts these values into `.lanekeeper/config.json`. When the file already exists, init does not change it; a copy with the missing keys filled in goes to `.lanekit/init-suggestions/.lanekeeper/config.json`.

```json
{
  "gate": { "command": "node scripts/lanekit/gate.mjs --profile light" },
  "code_standards": {
    "doc": "AGENTS.md#code-standards",
    "checks": ["node scripts/lanekit/gate.mjs --only structure"]
  },
  "release": {
    "gates": [{ "name": "lanekit-full", "command": "node scripts/lanekit/gate.mjs --profile full", "required": true }]
  },
  "lanes": { "commit": "allowed" },
  "paths": { "lane_reports": ".lanekit/reports/{lane}.md", "decisions": "docs/decisions/{date}-{slug}.md" }
}
```

`lanes.commit` uses lanekeeper's own value names. `allowed` means a lane commits to its own branch; `on-instruction` means it commits only when told to.

## Files kept outside the repository

| File | Contents |
|---|---|
| `~/.config/lanekit/denylist.txt` (`%APPDATA%\lanekit\denylist.txt` on Windows) | The denylist of a public repository. `LANEKIT_DENYLIST` changes the path |
| `~/.lanekeeper/machine.json` | Load and slot limits. It belongs to lanekeeper; lanekit only checks that it exists |
