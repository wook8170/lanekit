# Checks and the gate

The project runs the gate. It works without the lanekit plugin.

```
node scripts/lanekit/gate.mjs [--profile light|changed|full] [--only <id,…>] [--skip <id,…>] [--base <ref>]
node scripts/lanekit/gate.mjs --relock <id|all> --reason "<reason>" [--allow-increase --decision <ID>]
node scripts/lanekit/gate.mjs --list
```

There are three exit codes: 0 when no check failed, 1 when one did, 2 when the config or the arguments are wrong.

## Profiles

| Profile | When | Checks run |
|---|---|---|
| `light` | Every wave, before a push (pre-push hook) | `structure`, `docs-drift`, `writing`, `secrets`, `exposure`, `guidance`, `wiki` |
| `changed` | Pull requests | The light checks plus `tests` (changed-files command) |
| `full` | Before a release | Every check. `tests` runs the full command, and `audit`, `sbom` and `provenance` run as well |

## Checks

| ID | What it looks at | Default mode |
|---|---|---|
| `structure` | File length, function length, complexity, nesting, empty catch, `console`, import cycles, readability metrics. With the `ts-fastify` module, route metrics too | `warn` |
| `docs-drift` | Differences between numbers written in documents and values counted from code | `warn` |
| `writing` | Hype, metaphors, process phrases, forced translations of common terms, personification, long noun chains | `warn` |
| `secrets` | Secrets in tracked files. Uses gitleaks when present, otherwise 6 built-in rules | `fail` |
| `exposure` | Words that must not enter a public repository. The denylist lives outside the repository | `fail` when public, `off` otherwise |
| `guidance` | Guidance file size, duplicate sections, machine-bound paths, lines where the guidance breaks its own writing rules | `warn` |
| `wiki` | The document search link and a stale wiki index | `warn` |
| `tests` | The exit code of the project's test command | `fail` |
| `audit` | Vulnerabilities in production dependencies. Skipped when there is no lockfile. With a lockfile but no audit result (registry unreachable, package manager missing), the check is skipped as a warning in every profile and the reason goes to the evidence file | `fail` |
| `sbom` | Producing an SBOM (CycloneDX) | `warn` |
| `provenance` | Producing the provenance document | `warn` |

## From warning to ratchet

1. Right after init, every ratchetable check is `warn`. It only shows what it found.
2. Lock the current values as the baseline.
   ```
   node scripts/lanekit/gate.mjs --relock structure --reason "first baseline"
   ```
3. Set that check's `mode` to `ratchet` in `lanekit.config.json`. From then on the gate fails when a value grows. Violations that already existed still pass. The gate reads the baseline file together with the relock log. When the baseline file holds a value larger than the log, the gate fails even if the current value fits inside it. So a baseline is raised only through `--relock`, never by hand. A baseline lowered by hand is used as it is.
4. After reducing violations, relock. The lower value becomes the new limit.

## Relock control

- Without `--reason`, the relock is refused.
- A relock that raises a value needs `--allow-increase --decision <ID>`. `<ID>` is a file name in `docs/decisions/`; without that file, with content, the relock is refused. `README`, the template file, a file with only whitespace and a symbolic link do not count as decisions.
- An increase is judged per file. When one file shrinks and another grows so that the total stays the same, it is still an increase if any single file grew. Each file is compared with the smaller of two values: the baseline file and the last entry in the relock log. So deleting a baseline file or raising it by hand leaves the same control in place.
- After moving files, pass the pairs with `--moves <json>`. When the total of a moved group does not grow, it does not count as an increase. When the same file appears in two moves (as `from` or `to`), the list is ignored, files are compared one by one, and the relock needs a decision ID. In a relock with moves, a rule total that grows is also an increase.
- With `--relock all`, a check that skips itself (for example `structure` with no module on) is not locked and is reported as skipped. The other checks are locked. Naming a check directly is refused when that check skips itself.
- Every relock adds a line to `scripts/lanekit/baselines/relock-log.jsonl`. The line holds the reason, the decision ID, the totals per rule and every locked per-file value. K5 of `lanekit doctor` finds lines without a reason, increases without a decision, and baseline files whose per-file values differ from the last line in the log.
- When the last log line has no per-file values (`values`), nothing can be compared with it. The gate fails in `ratchet` mode, and a relock is accepted only with `--allow-increase --decision <ID>`.
- lanekit cannot stop someone from editing or adding a log line by hand. Commit the baselines and the log and check their changes in review. When the log is deleted, the gate fails in `ratchet` mode.

## Evidence files

Every gate run leaves `.lanekit/evidence/<first 12 characters of the commit>-<profile>.json`. It holds the commit, whether the working tree was clean (`dirty`), each check's mode, status, verdict and metrics, and the skipped checks with their reasons.

- A partial run made with `--only` or `--skip` goes to a file with a `-partial` suffix. It does not overwrite complete evidence.
- A release uses full evidence with `dirty` set to `false` and no skipped check. The `full` profile exits with code 1 when uncommitted changes are present, even if every check passes. `--only`, `--skip` and `--no-evidence` do not change this.
- `dirty` does not depend on repository settings or environment variables. Untracked files count whatever `status.showUntrackedFiles` says. One file with the `assume-unchanged` or `skip-worktree` flag makes the tree `dirty`, because git does not report edits to such a file. A repository that uses sparse checkout always carries the flag, so the full profile does not pass there. The gate does not pass git the environment variables that move the repository, work tree or index (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_COMMON_DIR`). `GIT_CONFIG_*` is passed through, so CI can still set `safe.directory` that way. The settings the dirty state depends on are fixed per command with `-c`.
- Evidence files, the SBOM, the provenance document, the test log, baselines and the relock log are written inside the repository only. Nothing is written when the target is a symbolic link or leads outside the repository through a link. Each write goes to a temporary file that is then renamed into place, so a file joined by a hard link keeps its content. When an evidence file or a baseline is blocked this way the gate exits with code 2; when a check's own record is blocked, that check fails. `--json <file>` writes to the path as given.
- G5 of `lanekit doctor` does not count evidence with `dirty` set to `true` or with a failed check.
- The provenance document of a partial run goes to `<commit>-provenance-partial.json`.
- A check that skips itself because a tool is missing or gave no result is a warning, not a failure. The evidence file keeps `reason: check-unverified` and the cause (`summary`) for that check. G5 of `lanekit doctor` counts such evidence but reports it as a warning. Whether to accept the cause before a release is a decision for a person.
- On an isolated network `audit` cannot reach the registry and is skipped with that warning. To state up front that the audit happens elsewhere, run with `--skip audit`. The evidence file records the skip.
- The provenance document is unsigned (SLSA Build L1 level). Signing and hosted builds are the project's responsibility.

## Enforcing remotely

| Means | File placed | Limit |
|---|---|---|
| git hook | `.githooks/pre-push` | Each clone needs `git config core.hooksPath .githooks` once. It can be bypassed. On Windows, init stages the hook in git with the executable bit (it does not commit), so that the hook runs in macOS and Linux clones |
| GitHub Actions | `.github/workflows/lanekit-gate.yml` | Merges are blocked only when branch protection requires this check |
| GitLab CI | `.gitlab/lanekit-gate.gitlab-ci.yml` | Runs only after an `include` line is added to the root `.gitlab-ci.yml` |

lanekit cannot provide approval by someone other than the author. It gives a `CODEOWNERS` template and a "Review" section in the pull request template, and no more.
