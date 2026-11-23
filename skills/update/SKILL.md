---
name: update
description: Bring the gate files copied to scripts/lanekit/ up to the installed lanekit version. Replaces only files the project has not modified, lists the modified ones and overwrites those only when the user says so. Baselines and the project's own files (AGENTS.md, config, templates) are never touched. Use when the user runs /lanekit:update, when doctor reports K3 (a newer lanekit is installed), or when asked to upgrade the gate scripts.
---

# lanekit update

Update the copied gate files of the project in the current working directory. Answer in the user's language.

## Steps

1. Run `lanekit update`. It changes nothing and prints, per file, what it would do.
2. Show the plan to the user. Point out two groups in particular:
   - files modified by the project, which stay as they are
   - files the new version dropped
3. When there are modified files, ask per file whether to keep the project's version or overwrite it. Before the user decides, show the difference between the file and the new source.
4. After the user confirms, run `lanekit update --yes`. Add `--force <path,path>` for the files the user chose to overwrite, or `--force all`.
5. Kept modified files get the new source under `.lanekit/update-suggestions/` so the user can compare later.
6. Run `node scripts/lanekit/gate.mjs --profile light` and then `lanekit doctor`, and report both.

## Rules

- Do not commit. Tell the user that `scripts/lanekit/` changed and let them decide.
- Baselines (`scripts/lanekit/baselines/`) are not part of an update. When a new version adds a metric, the gate reports it as a notice until the baseline is relocked with a reason.
- A modified copy usually means a need that the config cannot express. Suggest moving it into `lanekit.config.json`, or reporting it upstream, instead of keeping the edit.
