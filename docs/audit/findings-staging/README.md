# Findings staging

Add **one new file per real finding**: `YYYY-MM-DD-<slug>.md`, containing exactly what would
otherwise have been a new `docs/audit/FINDINGS.md` entry — the same `## <date> — [FINDING, ...]
...` heading, the `> **kind:** \`FINDING\`` line, and the table (or whatever shape the entry
takes — same rules as always, just in its own file).

## Why this exists (2026-08-23)

Every lane appended a new entry to the same anchor in one large `FINDINGS.md`, so every pair of
concurrent PRs collided there — not a real conflict (the entries were unrelated), but enough of one
that `automerge.yml` could never resolve it. With 9+ lanes landing inside the same 20 minutes, every
PR went stale within minutes of any other one merging: a rebase treadmill that could not converge at
that merge rate, even with a script (`findings-merge-resolve.mjs`) that unions the entries cleanly.

Writing to a uniquely-named file instead makes the collision structurally impossible: two lanes can
never touch the same file, so there is nothing left to conflict on.

## Folding into `FINDINGS.md`

`node scripts/audit/findings-fold-staging.mjs` appends every staged file into `FINDINGS.md` right
after the intro (newest first, matching the existing convention), then deletes the staged files. Run
it after a merge wave — the coordinator does this routinely, but anyone can run it any time. This is
now the **only** thing that writes to `FINDINGS.md`; lanes never edit it directly.

## What NOT to do

- **Do not edit `docs/audit/FINDINGS.md` directly in a lane PR.** That is the exact behavior this
  replaces, and doing it again reopens the collision.
- One entry per file. Do not reuse a filename (the date-prefixed name already makes collisions
  between two different findings on the same day distinguishable — add a longer slug if needed).
- Routine GREEN pass logs are unchanged by this — they still go straight into
  `docs/audit/RUN-LOG.md`, never staged here.
