# lanekit

lanekit lays a development setup onto a new project in one step. It works together with two other Claude Code plugins.

[한국어](README.ko.md)

## How the three plugins fit together

| Plugin | What it does | What stays in the project |
|---|---|---|
| **lanekeeper** | Enforces rules with hooks: git safety, lanes, slots, session guards, release gates | `.lanekeeper/config.json` |
| **wook-skills** | Provides the skills: writing, document wiki, code structure | Nothing (the skills live in the plugin) |
| **lanekit** | Provides the scaffold and the gate that the other two point at | `scripts/lanekit/`, `lanekit.config.json`, guidance and decision record templates |

lanekit has no hooks. lanekeeper does the enforcing, and lanekit writes its gate into lanekeeper's gate command and release gates. init and the gate still run on a machine without lanekeeper or wook-skills. In that case init skips the lanekeeper link and leaves the values in the suggestions folder, and `/lanekit:doctor` reports the missing plugins.

## What it does

| Command | What happens |
|---|---|
| `/lanekit:init` | Copies guidance templates, decision record templates and gate scripts into the project. The copied files become that repository's code |
| `/lanekit:doctor` | Checks 25 items: plugin installs, the copied files, gate connections, guidance size. Changes nothing |
| `/lanekit:update` | Brings the copied gate scripts up to the installed version. Files the project modified are listed, not replaced |

lanekit does not run the gate. The project does, with `node scripts/lanekit/gate.mjs`. The same gate therefore runs on machines without the plugin and in CI.

## Install

lanekit will be added to the `wook8170-plugins` marketplace, where lanekeeper and wook-skills already are. Once it is listed, install it with:

```
/plugin install lanekit@wook8170-plugins
```

lanekit declares lanekeeper and wook-skills as dependencies. The two dependencies are installed along with it only when all three are in the same marketplace.

Requirements: Node 22 or later. There are no runtime dependencies. macOS, Linux and Windows are supported. Windows needs Git for Windows, because the sh that ships with it runs the pre-push hook.

## Getting started

Run `/lanekit:init` at the repository root.

```
/lanekit:init                                         # asks five questions, shows the plan, writes after you confirm
node scripts/lanekit/gate.mjs --profile light         # run the gate
node scripts/lanekit/gate.mjs --relock all --reason "first baseline"
/lanekit:doctor
```

On day one every ratchetable check is in `warn` mode, so existing code does not block the gate. Lock a baseline, then raise a check to `ratchet`: from then on its numbers can only go down.

## The gate

| Check | What it looks at |
|---|---|
| `structure` | File and function size, complexity, nesting, empty catch, import cycles, readability metrics (TypeScript; route metrics with the `ts-fastify` module) |
| `docs-drift` | Numbers in documents against values counted from code |
| `writing` | Hype, metaphors, process phrases and other patterns a machine can find reliably |
| `secrets`, `audit`, `sbom`, `provenance` | Secret scan, dependency audit, SBOM and a provenance document |
| `exposure` | Denylisted words in a public repository |
| `guidance` | Size, duplicate sections and machine-bound paths in `AGENTS.md` and `CLAUDE.md` |
| `wiki`, `tests` | A stale document index; the project's own test command |

Three profiles choose what runs: `light` (every wave and before a push), `changed` (pull requests) and `full` (before a release). Every run leaves an evidence file in `.lanekit/evidence/`. Relocking a baseline needs a reason, and raising one needs a decision record.

## Turning things off

| Goal | How |
|---|---|
| Turn off one check | Set `checks.<id>.mode` to `off` in `lanekit.config.json` |
| Turn off one stack module | Remove it from `modules` |
| Skip once | `gate.mjs --skip <id>`. The evidence file records the skip |
| Turn off the pre-push hook | `git config --unset core.hooksPath` |
| Remove lanekit | Follow the five steps in [Updating and removing](docs/en/04-update.md) |
| Turn off only the plugin | `/plugin disable lanekit`. The copied gate is the project's code and keeps running |

No environment variable skips a check.

When a check skips itself because a tool is missing or gave no result, it is a warning in every profile, not a failure. The output marks it with `!`, and the evidence file keeps `check-unverified` as that check's `reason` and the cause in `summary`. G5 of `lanekit doctor` reports such evidence as a warning.

## Limits

- The provenance document is unsigned (SLSA Build L1 level). Signing and hosted builds are the project's responsibility.
- lanekit gives a pre-push hook and CI templates, but it cannot make a remote enforce them. Branch protection is set on the hosting side.
- Approval by someone other than the author cannot come from a tool. lanekit gives a `CODEOWNERS` template and a review section in the pull request template.
- Stack modules exist for TypeScript (`ts`) and Fastify (`ts-fastify`). Other stacks still get every check except `structure`.
- On Windows, commands written in the config (`checks.tests`, `checks.sbom.command`, the command source of `docs-drift`) run in cmd.exe. A command written in sh syntax (`;`, single quotes, `$NAME`) reads differently there. A repository used on both platforms should write commands that both shells read the same way, such as `node script.mjs`.

## Documents

- [Getting started](docs/en/01-start.md)
- [Configuration](docs/en/02-config.md)
- [Checks and the gate](docs/en/03-checks.md)
- [Updating and removing](docs/en/04-update.md)

## Origin

The structure check was moved from the structure lint of an in-house repository in production use, with its project-specific settings turned into configuration.

## License

MIT
