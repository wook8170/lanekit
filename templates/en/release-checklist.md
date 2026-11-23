# Release checklist

Go through this from the top for every release. When a box is skipped, give the reason in the release notes.

## 1. Full gate

- [ ] The working tree is clean (`git status` shows no changes)
- [ ] `node scripts/lanekit/gate.mjs --profile full` passes
- [ ] No check was skipped with `--skip`

## 2. Evidence

- [ ] `dirty` is `false` in `.lanekit/evidence/<commit>-full.json`
- [ ] The provenance document (`<commit>-provenance.json`) and the SBOM exist for the same commit
- [ ] No accepted dependency-audit entry has passed its expiry date

## 3. Tag

- [ ] The version file and the changelog are updated
- [ ] The tag is on the commit named in the evidence file

## 4. Release notes

- [ ] Changes visible to users are listed
- [ ] Known problems and skipped verification are listed

## 5. Upgrade notes

- [ ] If config or data formats changed, the migration steps are written down
- [ ] The way to roll back is written down

The provenance document this gate produces is unsigned (SLSA Build L1 level). Signing and hosted builds, when needed, are the project's to set up.
