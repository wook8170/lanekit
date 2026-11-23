# {{project}} working guide

This file is the canonical guide for agents and people working in this repository. Rules live here and nowhere else.

## Start here

- At the start of a session, read `progress.md` first and confirm where the previous session stopped.
- When you need the reasons behind a decision, look in `docs/decisions/`.
- `docs/memory-guide.md` says what belongs in memory.

## Repository shape

| Folder | Contents |
|---|---|
| `scripts/lanekit/` | The gate runner and its checks. lanekit copied these files, so do not edit them. Express project needs in `lanekit.config.json` |
| `docs/decisions/` | Decision records, one file per decision |
| `.lanekit/` | Lane reports and gate evidence files. Not tracked by git |

Add the project's own folders to this table. For each one, write one line: what it is for and which file to read first.

## Code standards

- Size limits: 500 lines per file, 60 lines per function (warning; 100 fails), complexity 15, nesting 4. Files and functions already over a limit must not grow. New files and new functions start within the limits.
- Separate deciding from doing. Put "is this allowed" and "what should happen" in pure functions that take input and return a result, apart from the code that changes things.
- Split by feature. Do not cut a function in source order into pieces named `part2` or `helpers2`.
- Keep parameters and input-object fields to 7 or fewer. UI components take 12 props or fewer.
- No single-letter names and no abbreviations (`tmp`, `cfg`, `obj`, `val`). Booleans start with `is`, `has`, `can` or `should`.
- Comments say what and why. History such as version or ticket numbers belongs in git.
- Start every new file with a three-line header comment: what it does, who calls it, which file to read first.
- Never swallow an error with an empty `catch`. Record even ignorable errors together with the reason.
- Keep each rule in one place. After moving code, do not leave a re-export file at the old path.

## Search order

1. For code flow, locations and the impact of a change, query codegraph first.
2. For documents, designs and decision history, query the document wiki first. The command is `docs_search.search` in `.lanekeeper/config.json`.
3. Confirm exact lines and strings with `rg`. Use `rg` for files that are not indexed (config, generated output) as well.

## Definition of done

- The tests and documents that match the change were updated in the same change.
- `node scripts/lanekit/gate.mjs --profile light` passes.
- Reports distinguish "implemented" from "merged" and "deployed".
- `progress.md` is updated at the end of each wave.

## Test sync

Whenever a feature is added, changed or removed, update its tests in the same change.

| Change | Tests |
|---|---|
| Added | Add tests for the new behaviour, its boundaries and its error paths |
| Changed | Update expectations and add a regression test that fails on the old code |
| Removed | Delete the tests of the removed feature. Keep tests of shared behaviour |

When you find a defect you cannot fix now, do not weaken the test. Mark it as pending and record the defect.

## Documentation cross-check

When a feature changes, update the documents that describe it in the same change. Count numbers and lists; do not copy them from existing documents. Mark what you could not verify as "unverified" instead of guessing. List pairs of "number in a document" and "value counted from code" in `checks.docs-drift.facts` of `lanekit.config.json`, and the gate reports any difference.

## Gate

```
node scripts/lanekit/gate.mjs --profile light     # every wave, before a push
node scripts/lanekit/gate.mjs --profile changed   # pull requests
node scripts/lanekit/gate.mjs --profile full      # before a release
```

- Each check has a `mode`: `off`, `warn`, `ratchet` or `fail`. Start with `warn`, lock a baseline, then raise the mode to `ratchet`.
- Relocking a baseline needs a reason. A relock that raises a value also needs a decision file in `docs/decisions/`.
- Every gate run leaves an evidence file in `.lanekit/evidence/`. A release uses full evidence produced from a clean working tree.

## Git

- `main` is the only long-lived branch. Work on a branch and merge through a pull request.
- Parallel lanes each use their own worktree and branch. A lane commits to its own branch. The main session merges into the integration branch and `main`.
- Commit and push when the user asks. Never delete an unmerged branch, even during cleanup.
- Remove a finished worktree after merging it. Stop the processes started from that path first.
