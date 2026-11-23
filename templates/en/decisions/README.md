# Decision records

Record decisions here that are hard to undo or that someone will later ask "why" about. One file per decision.

## File names

Use `<date>-<short-name>.md`, for example `2026-01-05-allow-growth.md`. Start from `0000-template.md`.

## When to write one

- A choice spans many files: structure, dependencies, data formats
- A gate baseline is relocked at a higher value. Pass this folder's file name (without the extension) to `--decision` of the relock command
- A delegated decision went ahead with the recommended option. Write "delegated" in the "decided by" field

## Rules

- Do not edit a recorded decision. When it changes, write a new file, set the old one to "superseded" and point it at the new file.
- Never list a single option. The rejected options and the reasons are what make a later review possible.
- Write the "reversal conditions": which facts, once changed, should reopen this decision.
