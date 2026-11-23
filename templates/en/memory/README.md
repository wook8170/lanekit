# Memory guide

Claude Code keeps memory in a personal folder outside the repository. The whole index (`MEMORY.md`) is read in every session, so a large index leaves less context for every session. This document separates what goes into memory from what does not.

## What goes into memory

- Traps: problems met in this repository or on this machine that are easy to hit again, with the way around them
- Incidents: the cause of something that went wrong once, and how to prevent it
- Personal preferences: things that differ per person, such as report format

## What does not go into memory

| Content | Where it belongs |
|---|---|
| Rules everyone follows | `AGENTS.md` |
| Decisions and their reasons | `docs/decisions/` |
| Release records and version plans | Release notes and documents |
| The state of current work | `progress.md` |
| Anything the code already shows | Nowhere |

A rule kept only in memory is invisible to other people and to CI. That is why rules live in repository files.

## Size limits

- `lanekit doctor` warns when the index exceeds 150 lines or 20 KB.
- An index line is one sentence: "name — when it matters". Details go into the entry file.
- Delete records of finished work. Move an entry that has become a rule to `AGENTS.md` and delete it from memory.

## Starter set

`lanekit init` places a starter set of principles and traps that recurred across projects at `.lanekit/init-suggestions/memory/MEMORY.md`. It never writes to the memory folder. Copy the entries you need by hand.
