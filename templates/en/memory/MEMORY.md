# Memory starter set

Principles and traps that recurred across projects. Copy only the entries that fit this repository into your memory index. Once an entry has become a rule, move it to `AGENTS.md` and delete it here.

## Principles

- Fix the root cause — a workaround recreates the same problem somewhere else.
- Report "implemented" apart from "merged" and "live on the server" — done means merged, restarted and verified.
- Never delete an unmerged branch, even during cleanup — ask the user first.
- Before deleting a folder, check whether a symlink or a worktree points at it.
- Create a lane (subagent) worktree from the base branch right before starting it — a stale base produces wrong reports.
- Ask before adding a step that the process does not have.

## Traps

- Two test runners in the same worktree share an output folder and fail for no real reason — run them one after another.
- Build and watch processes left behind by a removed worktree keep using CPU, and tests time out — check the load before trusting a failure.
- A dev server can serve the code from before your edit — look for a marker of the new code in the response before checking the screen.
- A dev server port may belong to another worktree — check which folder the process on that port started from.
- Committing to a worktree while it is being verified changes the build and makes the result stale — commit after verification ends.
- Integration tests that use the development database mix their data into it — start a database for tests only.
- A test run that ends abnormally leaves database sessions behind and the next run hangs — close them before running again.
- Hosting rejects a push whose commit holds a large file (100 MB or more) — check the size of artifacts before committing.
- `grep` can take a source file with much non-ASCII text for binary and drop matches — use `rg -a`.
- Temporary folders are emptied on reboot — keep reports and artifacts you will need again in the repository or a durable folder.
- A long gate run fails with timeouts when the machine goes to sleep — keep it awake and run fewer jobs at once.
