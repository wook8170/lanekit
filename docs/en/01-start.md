# Getting started

lanekit lays a development setup onto a new project in one step: guidance templates, decision record templates and gate scripts. The copied files become that repository's code, so the same gate runs on machines without the plugin and in CI.

## Requirements

- Node 22 or later
- macOS, Linux or Windows. Windows needs Git for Windows; the sh that ships with it runs the pre-push hook
- A git repository
- The plugins lanekeeper (0.2.7 or later) and wook-skills (0.1.2 or later). Installed from the same marketplace as lanekit, they come along automatically. init still finishes without them; it skips the lanekeeper link and the wiki link and says so.

## Laying it down

Run `/lanekit:init` in Claude Code. The skill asks five questions, shows the list of files it would create, and writes after you confirm.

| Question | Choices | Default |
|---|---|---|
| Language | `ko`, `en` | The value in the lanekeeper personal settings, when present |
| Project kind | `web-ui`, `service`, `library`, `other` | Detected from dependencies |
| Stack modules | `ts`, `ts,ts-fastify`, `none` | Detected from the `typescript` and `fastify` dependencies |
| Test commands | The full command and the changed-files command | The `test` script in `package.json` |
| Remote gate | `git-hook`, `github`, `gitlab`, `none` | Detected from the remote URL |

In a terminal, pass the same answers as flags.

```
lanekit init --lang en --kind service --modules ts --test-full "npm test" --remote-gate git-hook
lanekit init --lang en --kind service --modules ts --test-full "npm test" --remote-gate git-hook --yes
```

Without `--yes`, init only shows the plan and writes nothing. Three more flags exist.

| Flag | Effect |
|---|---|
| `--edit-gitignore` | Appends `.lanekit/` and `.env` to an existing `.gitignore` |
| `--set-hooks-path` | Runs `git config core.hooksPath .githooks` to turn on the pre-push hook. When another hooks folder is already set, it is left alone and reported |
| `--lock-baselines` | Locks baselines at the current values. Modes stay at `warn` |

## Files it creates

| File | Condition |
|---|---|
| `lanekit.config.json` | Always |
| `scripts/lanekit/` and `scripts/lanekit/lanekit.lock.json` | Always |
| `AGENTS.md`, `CLAUDE.md`, `progress.md` | When missing |
| `docs/decisions/README.md`, `docs/decisions/0000-template.md` | When missing |
| `docs/memory-guide.md`, `docs/release-checklist.md` | When missing |
| `.lanekeeper/briefs/common.md` | When missing |
| `.githooks/pre-push` | When the remote gate is not `none` |
| `.gitattributes` | When missing. It keeps the hook and `scripts/lanekit/` on LF line endings. With CRLF from a Windows checkout, sh cannot read the hook |
| `.github/workflows/lanekit-gate.yml`, `.github/CODEOWNERS`, `.github/pull_request_template.md` | When the remote gate is `github` |
| `.gitlab/lanekit-gate.gitlab-ci.yml`, `CODEOWNERS` | When the remote gate is `gitlab` |
| `.lanekeeper/config.json` | When missing and lanekeeper is installed |

**Existing files are never overwritten.** When the content differs, the proposed content goes to `.lanekit/init-suggestions/<path>` and is listed. Running init several times therefore gives the same result.

init never writes to the memory folder. The memory starter set goes to `.lanekit/init-suggestions/memory/MEMORY.md`, and you copy the entries you need.

## After laying it down

1. init runs the light gate once and shows the current values. Only `secrets`, `audit` and `tests` are `fail`; the rest are `warn`. Existing code therefore does not block the gate on day one.
2. init runs doctor and shows the state of the connections.
3. init does not commit. It only lists the paths to commit.
4. For a public repository, set `repo.visibility` to `public` in `lanekit.config.json`. The exposure check then becomes mandatory.

## Checking

```
lanekit doctor
lanekit doctor --json
```

doctor looks at 25 items and prints a status and a one-line fix for each. It changes nothing. The exit code is 1 when any item fails.

| Group | What it looks at |
|---|---|
| P1 – P4 | Required plugins and versions, session guards left in personal hooks, the lanekeeper machine settings |
| K1 – K6 | Config schema, copy against the lock file, copy version, baselines, relock log and hand-edited baselines, TypeScript compiler (5 or 6) |
| G1 – G5 | The lanekeeper gate command and release gate, the pre-push hook, the CI file, evidence for HEAD |
| W1, W2, C1 | Document search link, wiki index, codegraph index |
| I1 – I4 | Guidance size, machine-bound paths and duplicate sections, memory index size |
| E1, S1, S2 | Denylist of a public repository, gitleaks, `.env` ignored |

## Roles of the three plugins

| Work | Owner |
|---|---|
| Blocking with hooks; lanes, slots and ports; session guards; release gate stamps | lanekeeper |
| Writing, document wiki and code structure skills | wook-skills |
| init, doctor and update; the gate runner and checks; guidance, decision and CI templates | lanekit |

lanekit creates no Claude Code hooks. It only links the gate command and the release gate into `.lanekeeper/config.json`.
