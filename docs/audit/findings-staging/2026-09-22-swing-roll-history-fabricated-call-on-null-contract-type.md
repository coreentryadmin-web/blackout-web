> **kind:** FINDING

## Swing roll-history narrative fabricated "call" for a leg whose contract type was never recorded — FIXED

**Status:** FIXED (2026-09-22, Ask Largo × Night Hawk Swings standing mandate deep-dive)

### What was broken

`swingRollHistoryLegFromRow` (`src/lib/swing/play-brief-roll-history.ts`) mapped a rolled leg's
DB `contract_type` to the short "P"/"C" code every reader in this codebase uses, via
`r.contract_type === "put" ? "P" : "C"`. `contract_type` is a genuinely nullable column
(`db.ts`: `contract_type TEXT`, no `NOT NULL`; `SwingPositionInsert.contract_type?: string | null`
with `?? null` fallbacks at every insert site) — a position row, including a rolled leg, can
legitimately have no recorded contract type. The ternary's fallback branch collapsed that
genuine absence into `"C"` (call) rather than the honest "unknown."

`SwingRollHistoryLeg.right` is typed `string | null` specifically so callers CAN represent
"unknown" (`play-brief-types.ts`), and `rollHistoryLine`'s `fmtLeg` (`play-brief-narrative.ts`)
already carries an honest fallback wired for exactly this case:
`l.right === "P" ? "put" : l.right === "C" ? "call" : "contract"`. That fallback has been dead
code since the roll-history disclosure shipped (#4802) — this mapper never emitted `null`, so
`fmtLeg` never saw anything but `"P"` or `"C"`.

### Why this matters

A trader reading "**Rolled once** — most recently from the $90 call to the $85 call" on a leg
whose true contract type was never recorded (a real, reachable DB state) would be told a
fabricated direction with full narrative confidence — not the honest generic "$90 contract" the
render layer was already built to say for exactly this case. This is a direct Largo product
contract violation (C3, absence): an invented value read by the trader as measured fact.

### Fix

`right: r.contract_type === "put" ? "P" : r.contract_type === "call" ? "C" : null` — now maps any
unrecognized or missing `contract_type` to `right: null`, letting the render layer's existing
honest fallback fire instead of inventing `"C"`. Zero behavior change for the two real values
(`"put"`/`"call"`) that account for every populated row today.

### Evidence

- New regression test in `play-brief-roll-history.test.ts`: "a null contract_type maps to
  right: null (honest absence), never a fabricated 'C'" — RED→GREEN proven directly (git-stash
  the source fix only, keeping the new test: 2/3 pass with the new test the sole failure,
  `actual: 'C'` vs expected `null`; restore the fix: 3/3 pass).
- `npx tsc --noEmit` clean.
- Full suite run alongside this fix (see PR for exact pass count).

### Blast radius

Single function, single file. `closed-plays.ts`, `live-plays.ts`, and `play-brief-resolve.ts`
share the identical `contract_type === "put" ? "P" : "C"` pattern, but each of them already
short-circuits to `null`/no-match earlier whenever `contract_expiry`/`contract_strike` are
missing — a state that in practice never occurs without `contract_type` also being unset at the
same commit/roll write — so those three call sites carry materially lower real-world exposure to
this exact fabrication and are left untouched here to keep this a single, narrowly-scoped fix
matching the one genuine narrative-facing gap found. Not claimed to be theoretically impossible
there — worth a follow-up sweep if a future audit surfaces a live disagreement.
