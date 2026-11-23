# Updating and removing

## Updating

`scripts/lanekit/` is a copy. Updating the lanekit plugin leaves the copy as it is. `lanekit update` changes the copy.

```
lanekit update            # shows the plan only
lanekit update --yes      # applies it
lanekit update --yes --force checks/guidance/run.mjs
lanekit update --yes --force all
```

`scripts/lanekit/lanekit.lock.json` holds the sha256 of every copied file. update uses these hashes to tell "as copied" from "modified by the project".

| State of the file | What update does |
|---|---|
| As copied, and different from the new source | Replaces it with the new source |
| Already the same as the new source | Leaves it |
| Modified by the project | Leaves it and lists it. The new source goes to `.lanekit/update-suggestions/` |
| Modified by the project and named in `--force` | Overwrites it with the new source |
| Missing from the copy | Places it again |
| New in the new version | Adds it |
| Dropped by the new version, as copied | Removes it |
| Dropped by the new version, modified by the project | Keeps it and lists it |

When a path to write or remove is a symbolic link, or leads outside the repository through a link, update names that path, changes nothing and exits with code 2. Replace the link with a real file or folder and run it again.

update does not touch the following.

- Baselines and the relock log (`scripts/lanekit/baselines/`)
- `lanekit.config.json`
- Files init placed from templates (`AGENTS.md`, `progress.md`, decision records, CI files). Once placed, they belong to the project.

When a new version adds a metric, the baseline has no entry for that rule. The gate reports this as a notice, not a failure. Relocking with a reason clears the notice.

After an update, run `node scripts/lanekit/gate.mjs --profile light` and `lanekit doctor` to confirm.

## When the copy needs a change

A file you edit in the copy is skipped by update, so it stops receiving fixes from new versions. Express project needs in `lanekit.config.json` first. When the config cannot express a need, ask the lanekit repository for a new config key.

## Removing

1. Turn off the git hook with `git config --unset core.hooksPath`.
2. Remove three entries from `.lanekeeper/config.json`: `gate.command`, the gate line in `code_standards.checks`, and `lanekit-full` in `release.gates`.
3. Delete the CI file: `.github/workflows/lanekit-gate.yml`, or `.gitlab/lanekit-gate.gitlab-ci.yml` together with the `include` line in `.gitlab-ci.yml`.
4. Delete `scripts/lanekit/`, `lanekit.config.json` and `.githooks/pre-push`.
5. Delete the `.lanekit/` line in `.gitignore` and the `.lanekit/` folder.

Files that came from templates, such as `AGENTS.md` and `docs/decisions/`, are project documents and may stay. Do update the "Gate" section of `AGENTS.md`.
