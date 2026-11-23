# Common lane brief

Put this file in front of the brief whenever you start a lane. Fill in only the fields in parentheses for the version and wave.

## This wave

- Version and wave: (fill in)
- Integration branch and base commit: (fill in)
- Files this lane may change: (fill in)
- Files it must not touch: (fill in)

## Writing

- Write reports in the user's language. Keep code, paths and commands verbatim.
- State the relation between sentences (cause, result, contrast, condition) with a connecting word.
- Do not describe things as if they were people. Describe what actually happens.
- Do not chain three or more nouns without the words that relate them.
- Keep the subject and its verb close together.
- Use the terms the industry uses (version, branch, commit, test, build) as they are.

## Rules

- Work only in your own worktree and branch. When a file outside your scope needs a change, do not make it; report it.
- One file is changed by one lane only.
- Follow "Code standards" in `AGENTS.md`. New files and new functions start within the limits.
- Do not edit gate baselines (`scripts/lanekit/baselines/`). Only the main session locks them.
- Do not use `git stash`. Do not delete unmerged branches.
- Run browsers headless only.
- Do not write to production data or to the development database the user works in. Run tests against a test database.

## Tests and load

- Run only the test files you created or changed. The main session runs the full tests and the full gate once, after merging the lanes' work.
- Check the load before running tests or builds. When it is high, wait with the heavy steps until it drops.
- Do not run two test runners at once in the same worktree.
- When a feature changes, update its tests in the same change. When nothing applies, open the tests and say that you checked.

## Search

- Query codegraph first for code and the document wiki first for documents and decisions. Confirm exact lines with `rg`.

## Report

Return the report and also save it to `.lanekit/reports/<lane>.md`. Include:

- Files changed
- Test commands run and their results
- Verification not run, with the reason
- Documents updated, or the evidence that none applied
- Suspected defects and remaining work
