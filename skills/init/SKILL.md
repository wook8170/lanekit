---
name: init
description: Lay the lanekit setup onto the current project — guidance templates (AGENTS.md, CLAUDE.md, progress.md), decision record templates, the gate runner copied to scripts/lanekit/, a pre-push hook and optional CI templates. Asks five questions, shows the plan, writes only after the user confirms, never overwrites an existing file and never commits. Use when the user runs /lanekit:init or asks to set up lanekit, a gate, ratchets or the development scaffold in a repository.
---

# lanekit init

Set up lanekit for the project in the current working directory. Answer in the user's language.

## Steps

1. Run `lanekit init` with no other arguments. It writes nothing; it prints the detected values and the list of files it would create. Read the output.
2. Ask the user these five questions in one message. Show the detected value as the default for each.
   - Language of messages and templates: `ko` or `en`. Skip this question when `~/.lanekeeper/personal.json` already has a language; lanekit uses it.
   - Project kind: `web-ui`, `service`, `library`, `other`
   - Stack modules: `ts`, `ts,ts-fastify` or `none`
   - Full test command, and the command that runs only the tests for changed files (`{files}` marks where the file list goes). Either may be empty.
   - Remote gate: `git-hook` (pre-push hook only), `github` (hook plus Actions workflow, CODEOWNERS and PR template), `gitlab` (hook plus CI template), `none`
3. Run the plan again with the answers and show it to the user:
   ```
   lanekit init --lang <ko|en> --kind <kind> --modules <ts|ts,ts-fastify|none> --test-full "<command>" --test-changed "<command>" --remote-gate <value>
   ```
   Lines marked `?` are files that already exist. lanekit leaves them alone and puts the proposed content under `.lanekit/init-suggestions/`.
4. Ask three yes/no questions before writing:
   - Add `.lanekit/` and `.env` to an existing `.gitignore`? (`--edit-gitignore`)
   - Turn on the pre-push hook with `git config core.hooksPath .githooks`? (`--set-hooks-path`). When the repository already uses another hooks folder, lanekit leaves it alone; tell the user to call `.githooks/pre-push` from their existing pre-push hook.
   - Lock baselines now? (`--lock-baselines`). Modes stay at `warn` either way; the user raises a check to `ratchet` in `lanekit.config.json` later.
5. After the user confirms, run the same command with `--yes` and the flags the user agreed to.
6. Report the output section by section: files written, files left untouched with the path of each suggestion, the lanekeeper link, the first gate run, the doctor result and the list of paths to commit.
7. For each suggestion file, offer to merge it into the existing file and do so only when the user agrees.

## Rules

- Do not commit. Show the list of paths to commit and let the user decide.
- Do not write into the Claude Code memory folder. The memory starter set stays in `.lanekit/init-suggestions/memory/MEMORY.md` for the user to copy from.
- When lanekeeper is not installed, init still finishes: it skips lanekeeper init and the wiki link and says so. Do not install plugins without consent.
- `repo.visibility` starts as `private`. When the repository is public, tell the user to set it to `public`; the exposure check then becomes mandatory and needs a denylist outside the repository.
- Do not edit files under `scripts/lanekit/` by hand. Project needs go into `lanekit.config.json`.
