---
name: doctor
description: Check the lanekit setup of the current project — required plugins and their versions, duplicated personal session hooks, the config schema, copied gate files against the lock file, baselines and the relock log, the lanekeeper gate link, the pre-push hook and CI file, gate evidence for HEAD, the wiki and codegraph indexes, guidance and memory size, the denylist of a public repository and secret-scan tooling. Read-only. Use when the user runs /lanekit:doctor or asks whether lanekit, the gate or the scaffold is set up correctly.
---

# lanekit doctor

Check the project in the current working directory. Answer in the user's language.

## Steps

1. Run `lanekit doctor`. Add `--json` when you need to process the result.
2. Report the items that are not `ok`, failures first, each with its ID, what was found and the fix line that doctor printed. Summarise the `ok` items in one line.
3. Offer to apply a fix only when it changes files inside the repository, and only after the user agrees.

## Reading the result

| Mark | Meaning |
|---|---|
| `✓` | ok |
| `!` | warning. The gate still runs, but something is not connected or is out of date |
| `✗` | failure. The exit code is 1 |
| `-` | skipped because the check does not apply on this machine |

IDs group the checks: `P` plugins and personal settings, `K` the copied kit, `G` gate connections, `W` wiki, `C` codegraph, `I` guidance and memory, `E` exposure, `S` secrets.

## Rules

- doctor changes nothing. Do not fix anything without asking.
- Never edit personal settings (`~/.claude/settings.json`, `~/.lanekeeper/`) on your own. For `P3` and `P4`, show the user what to change.
- `K2` lists files the project modified. Do not revert them; ask whether the change should move into `lanekit.config.json`.
