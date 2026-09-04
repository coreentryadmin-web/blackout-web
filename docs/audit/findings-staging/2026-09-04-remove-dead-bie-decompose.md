## 2026-09-04 — [FINDING, P4 dead-code, Largo/BIE] `bie/decompose.ts` — the compound-question splitter never wired into `composeCompound` — REMOVED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Priority** | P4 — dead code, no behavior change, no member-visible effect |
| **Surface** | `src/lib/bie/decompose.ts` (+ its own `decompose.test.ts`) |
| **Status** | FIXED |

### Root cause

`docs/audit/FINDINGS.md`'s 2026-08-30 entry *"The 2026-08-10 'clean follow-up deletion' of orphaned
`bie/*` files is not as clean as it read"* re-examined four files a prior finding had called a
"clean follow-up deletion" (`router.ts`, `composers.ts`, `decompose.ts`, `dynamic-format.ts`) and
found the claim was only partly true: `router.ts` turned out to still be needed (its `BieRoute`
*type* — not the deleted functions — is imported by several live `bie/*` files), and
`composers.ts`/`dynamic-format.ts` couldn't be confidently deleted because the one file that
references `composers.ts` (`largo-terminal.test.ts`) cannot run in this sandbox (`node:test`'s
`mock.module` gap), so whether CI actually exercises it was left unconfirmed. `decompose.ts` was
the one file of the four that entry confirmed **"genuinely dead by static analysis"** with no
caveat: zero imports anywhere in `src/` except its own test file.

Re-verified against current `main` this cycle before acting: `grep -rn "bie/decompose\|from
[\"']\./decompose[\"']" src` (excluding the file's own declaration and its test) returns nothing —
still zero non-test consumers, five weeks after the original finding. `decompose.ts` is a pure,
self-contained module (`splitCompoundQuestion` and friends — a "15 questions in one ask" splitter
for task #57) with no external imports of its own, so removing it carries no ripple risk into
`router.ts`/`composers.ts`/`dynamic-format.ts`, which stay exactly as the 2026-08-30 finding left
them (untouched, still flagged OPEN for the Largo lane).

### Evidence

RED→GREEN via `src/repo-hygiene.test.ts`'s existing `"known-orphaned modules stay removed"`
allowlist test (the same guard PR #3624 added for six other zero-importer files):
- **RED** (pre-removal): added `"src/lib/bie/decompose.ts"` to the allowlist first — `npx tsx
  --test src/repo-hygiene.test.ts` failed with `AssertionError: these dead files were removed as
  unused... src/lib/bie/decompose.ts` (the file was still tracked).
- **GREEN** (post-`git rm`): same test, 5/5 pass.

`npx tsc --noEmit` clean on Node 20.20.2 (no orphaned type-only import). Full `npm test` run
in progress at write time — see the PR for the final pass count; expected to match `main`'s
existing baseline exactly, since this diff only removes an already-unreferenced file pair.

### Fix

`git rm src/lib/bie/decompose.ts src/lib/bie/decompose.test.ts`; inlined `isCompoundQuestion` in
`scripts/largo-stress-run.mjs` (the only non-`src/` consumer — #3219 restored this file after
#3203 deleted it without checking `scripts/`). Extended `repo-hygiene.test.ts`'s orphan allowlist.

### Blast radius

None beyond the two removed files — `scripts/largo-stress-run.mjs` updated to inline compound
detection (`LARGO_STRESS_LIMIT=5` smoke: 0 router mismatches). `router.ts`, `composers.ts`, and
`dynamic-format.ts` unchanged.

### What was deliberately NOT done

Not touching `composers.ts`, `dynamic-format.ts`, or `router.ts` — the 2026-08-30 finding's own
reasoning for leaving those alone (an unrunnable-here test whose liveness can't be confirmed
locally, and a still-used exported type) is unchanged by this cycle's re-verification and still
stands. That entry remains the tracking record for whoever owns Largo/CI to pick up.
