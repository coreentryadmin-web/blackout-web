> **kind:** FINDING

## `counterThesisLine` never gates its 0DTE directional check on `is_condor` — same bug class as #4788, third call site — FIXED

| | |
|---|---|
| **Area** | Ask Largo — swing play-brief (`src/lib/swing/play-brief-narrative.ts`, `counterThesisLine`) |
| **Status** | FIXED |
| **Severity** | P2 (fabricates a directional counter-thesis reason from a delta-neutral structure — misleads the trader-facing "why the other side might win" read) |

### Root cause

`EcosystemZeroDteTake.is_condor` (`src/lib/bie/ecosystem-context.ts`) carries an explicit doc
comment: a committed iron condor's `direction` column is **nominal provenance only** (the fade
side of the pin it came from) — the structure itself is delta-neutral, so a directional-alignment
claim built off it is meaningless. The comment names one consumer that must gate on it
(`flowIntelSection`), but by the time this bug was found there were already two real gated call
sites:

- `flowIntelSection` (`play-brief-intel.ts:1539`) — `if (z.is_condor === true) { ... }`
- `crossDeskCoaching` (`play-brief-narrative-coaching.ts:849-850`) — `zLong =
  z?.direction === "long" && z?.is_condor !== true` (fixed under #4788, whose own comment records
  it as a second call site the original fix missed)
- `ticker-verdict.ts:37/89` — `if (z && z.is_condor !== true) { ... }` / `z.is_condor === true`

`counterThesisLine` (`play-brief-narrative.ts`, lines ~1159-1163 before this fix) read the
identical `z.direction` field for the identical "does 0DTE oppose the swing's own direction"
comparison, with **no `is_condor` check at all**:

```ts
// before
if (play.direction === "LONG" && z?.direction === "short") {
  reasons.push(`0DTE short bias (score ${z.score ?? "—"})`);
} else if (play.direction === "SHORT" && z?.direction === "long") {
  reasons.push(`0DTE long bias (score ${z.score ?? "—"})`);
}
```

So a committed iron condor's nominal fade-side `direction` could be pushed into the swing brief's
"Counter-thesis" bullet list as if it were a genuine opposing directional read from the 0DTE desk
— the exact misrepresentation the `is_condor` field exists to prevent, on a fourth call site the
field's own doc comment did not anticipate when it was written.

### Failure scenario

1. Today's 0DTE take for a ticker is a committed iron condor whose nominal fade side is `"short"`
   (`z.direction === "short"`, `z.is_condor === true`).
2. A swing play on the same ticker is `LONG`.
3. `counterThesisLine` pushes `"0DTE short bias (score N)"` into the counter-thesis reasons list,
   and the rendered brief tells the trader the 0DTE desk is bearish — when in fact 0DTE holds a
   delta-neutral condor with no directional view at all. The trader reads a fabricated opposing
   signal into their risk assessment.

### Evidence

- Confirmed live by reading current `main` (`src/lib/swing/play-brief-narrative.ts` lines
  1152-1163, `src/lib/bie/ecosystem-context.ts` lines 40-58) before writing any fix — the
  `is_condor` field and its doc comment exist exactly as described, and `counterThesisLine` read
  `z.direction` with no guard.
- Added a regression test (`counterThesisLine: condor 0DTE take must not steelman a directional
  counter-thesis reason`) and confirmed **RED on the pre-fix code**:
  ```
  + "**Counter-thesis (bear case)** — a single, uncorroborated signal — 0DTE short bias (score 78). ..."
  - null
  ```
- Confirmed **GREEN** after the fix: `npx tsx --experimental-test-module-mocks --test
  src/lib/swing/play-brief-narrative.test.ts` → 159/159 pass.

### Fix

Mirror `crossDeskCoaching`'s exact guard shape: compute `zCondorSafe = z?.is_condor !== true`
once and require it alongside the existing direction comparison before pushing either 0DTE
reason. No other reason in `counterThesisLine` (HELIX flow, Night Hawk, Vector bias, GEX walls)
reads `is_condor` — only the 0DTE-direction comparison needed the guard, since it is the only
reason in this function sourced from a type that can carry a delta-neutral structure.

### Blast radius

Single call site inside `counterThesisLine`. Full repo grep (`grep -rn is_condor src/lib/`)
confirms the three already-gated call sites (`flowIntelSection`, `crossDeskCoaching`,
`ticker-verdict.ts`) are unaffected and unchanged — this fix adds the missing fourth gate, it
does not touch any of the others. `zerodteLiveForSession`/`EcosystemZeroDteTake` themselves are
untouched (read-only consumers).

### Tests

`src/lib/swing/play-brief-narrative.test.ts`:
- `counterThesisLine: condor 0DTE take must not steelman a directional counter-thesis reason
  (same bug class as #4788)` — new, proves the fix (RED pre-fix, GREEN post-fix).

`npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-narrative.test.ts`:
159/159 pass. Broader regression sweep `npx tsx --experimental-test-module-mocks --test
src/lib/swing/*.test.ts src/lib/bie/*.test.ts`: 2926/2926 pass. `npx tsc --noEmit` clean.
