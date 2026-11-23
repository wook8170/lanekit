# Changelog

## 0.1.0

First version.

### Commands

- `lanekit init` copies the gate scripts, guidance templates and decision record templates into a project. Existing files are never overwritten; the proposed content goes to `.lanekit/init-suggestions/`.
- `lanekit doctor` checks 25 items: plugin installs, the copied files, baselines and the relock log, gate connections, the wiki link, guidance size, the denylist and secret scanning.
- `lanekit update` brings the copied scripts up to the installed version. Files the project modified are listed and left alone unless `--force` names them.

### Gate

- `gate.mjs` runs the checks of a profile (`light`, `changed`, `full`), judges each check by its mode (`off`, `warn`, `ratchet`, `fail`) and writes an evidence file. Exit codes: 0 pass, 1 failed check or refused relock, 2 configuration or usage error.
- Relocking a baseline needs `--reason`. Raising a value also needs `--allow-increase --decision <ID>` with a matching file in `docs/decisions/`. Every relock is logged.
- Checks: `structure`, `docs-drift`, `writing`, `secrets`, `exposure`, `guidance`, `wiki`, `tests`, `audit`, `sbom`, `provenance`.
- A check that skips itself because a tool is missing or gave no result is a warning in every profile, `full` included. The evidence file keeps the reason, and `lanekit doctor` G5 reports it. This covers `audit` (lockfile present, no readable result) and `structure` (the `ts` module is on, typescript missing).
- The `full` profile exits with code 1 when uncommitted changes are present. `lanekit doctor` G5 does not count evidence from a dirty or failed run. The dirty state ignores repository settings and the `GIT_` variables that move the repository or index, and a file flagged `assume-unchanged` or `skip-worktree` counts as dirty.
- Relock increases are judged per file against the smaller of the baseline file and the last relock log entry. The log keeps every locked per-file value. `--moves` entries that share a file need a decision ID.
- In `ratchet` mode the gate fails when the baseline file holds a value larger than the relock log, or when the last log line has no per-file values.
- File names with quotes, tabs or backslashes, and names in decomposed Unicode form (NFD), are read by `secrets`, `exposure` and `structure`. The denylist matches text in either Unicode form.
- `exposure` in the `full` profile also reads taggers, tag messages, and tag and branch names.
- `init`, `update` and the gate (evidence, SBOM, provenance, test log, baselines, relock log) do not write or remove through a symbolic link or outside the repository. Writes replace the file by rename, so a hard-linked file elsewhere keeps its content.
- Stack modules: `ts` (structure and readability metrics, needs typescript 5 or 6) and `ts-fastify` (route metrics and the ESLint rule `lanekit/no-reply-thenable`).

### Platforms

- macOS, Linux and Windows are supported. Platform differences live in one file, `kit/lib/platform.mjs`.
- On Windows the denylist is read from `%APPDATA%\lanekit\denylist.txt`, tools installed as `.cmd` files (npm, pnpm, yarn) are found through `PATHEXT` and run with quoted arguments, and file names passed to the changed-files test command are quoted for cmd.exe.
- Files with CRLF line endings are read the same as LF files by every check, and the lock file hashes content with line endings normalised, so a CRLF checkout is not reported as modified.
- `init` writes a `.gitattributes` that keeps the hook and `scripts/lanekit/` on LF. `lanekit doctor` G3 warns when the hook has CRLF line endings, and on Windows when the hook is in the git index without the executable bit.
- Paths in the gate output, the evidence file and the provenance document use `/` on every platform.

### Templates

- Korean and English templates for `AGENTS.md`, `CLAUDE.md`, `progress.md`, decision records, the release checklist, a pre-push hook, and CI files for GitHub Actions and GitLab CI.
