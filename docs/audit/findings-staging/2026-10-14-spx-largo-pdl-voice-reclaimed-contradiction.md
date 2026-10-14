> **kind:** FINDING

## Ask Largo SPX commentary rail: a broken-down PDL narrates "reclaimed ... holding above it" in the same line as "pts overhead" — FIXED

| **Status** | FIXED |
|---|---|

**Root cause.** `deriveWatchLevels()` (`src/lib/bie/spx-live-voice.ts`) composes the live "Largo"
watch-levels rail rendered on the SPX desk (`SpxCommentaryRail.tsx`, `deriveWatchLevels(renderSnap)`
at line ~327) — short, side-aware narration lines for the nearest levels to spot. Each candidate
level carries a `meaning(side)` callback, where `side` is computed from the ACTUAL current
price/level relationship (`c.level >= p ? "above" : "below"`), not a hypothetical. PDL's callback
had:

```ts
meaning: (side) =>
  side === "below"
    ? "lose it and it's a multi-day breakdown — longs above become supply"
    : "yesterday's low reclaimed — holding above it repairs the damage",
```

`side === "below"` means PDL sits below price (not yet broken — correct, future-oriented text).
The `else` branch fires when `side === "above"`, i.e. **PDL sits above price** — price has ALREADY
broken DOWN through PDL, so PDL is now overhead resistance. The text in that branch instead
describes a **reclaim** (price back ABOVE PDL, "holding above it repairs the damage") — the
opposite of the state that triggers it. This is the narration-layer sibling of the bug `#6013`
fixed in `buildLevels()`'s `kind` field the same day: PDL is a PRIOR-SESSION level, not a
tautological bound like LOD, so price is genuinely free to trade through it (see
`spx-desk-levels.ts`'s `priorSessionLevelKind` doc comment for the structural argument). The
likely origin: PDL's two branches read as if modeled on LOD's own symmetric pair two blocks above
(`"break it and the range extends lower..."` / `"reclaimed low — holding above it repairs the
tape"`) — safe for LOD only because LOD is tautologically `<= price` (so that branch is
practically unreachable there), but PDL carries no such bound, so the copied "reclaimed" text is
genuinely reachable and wrong.

**Evidence.** Reproduced in isolation (not inferred from reading code): calling the live function
with `price: 7512.3, pdl: 7560` (PDL 47.7 pts ABOVE price — a broken-down prior-day low, same
breakdown-day shape as the live SPX desk snapshot `#6013` captured the same day, price 7718.94 /
pdl 7786.11) produced:

```
PDL 7,560 · 47.7 pts overhead — yesterday's low reclaimed — holding above it repairs the damage
```

One line, self-contradicting: "47.7 pts overhead" (PDL above price → price is below PDL, still
broken down) directly beside "holding above it repairs the damage" (implies price is above PDL,
i.e. reclaimed). A member reading this rail sees a level flagged as still-overhead resistance
narrated in the same breath as if it had already been reclaimed.

Checked every sibling level in the same composer for the identical class of error before
concluding PDL was the only one: PDH (correct, symmetric "now support" branch), HOD/LOD
(tautologically bounded, the unreachable-edge-case branch is inert), γ-flip, call wall, put wall,
VWAP — all correctly side-aware in both branches, matching the "hasn't happened yet" / "already
happened, new role" convention PDH/call-wall/put-wall/VWAP/γ-flip already follow correctly. PDL was
the sole outlier.

No existing test exercised this branch: `spx-live-voice.test.ts`'s only `deriveWatchLevels` fixture
(`rich()`) sets `pdl: 7490` with `price: 7512.3` (PDL below price, the common/safe case) — the
broken-down case had zero coverage.

**Fix.** Mirrored PDH's already-correct symmetric branch for the breakdown direction:

```ts
: "yesterday's low is now resistance — reclaiming it would repair the damage",
```

Describes the real current role (PDL now overhead resistance) and keeps the forward-looking
"reclaiming it would help" framing honest about tense (it HASN'T happened, consistent with
`side === "above"` meaning price is still below PDL) — same shape as PDH's "now support —
holding above it keeps the breakout alive" for the opposite direction. The `side === "below"`
branch (not yet broken) was left untouched — it was already correct.

**Fix rationale.** Considered leaving PDL neutral (no directional meaning) like the GEX King node,
but rejected for the same reason `#6013` rejected it for `kind`: PDL's role IS fully determined by
which side of it price currently sits, so narrating the correct role is strictly better than
discarding the signal. Did not touch LOD's own analogous "else" branch (`"reclaimed low — holding
above it repairs the tape"`) — that branch is genuinely unreachable in practice (LOD `<= price` by
construction, same argument `#6013`'s own comment makes for `kind`), so there is no live
contradiction to fix there, and touching dead code purely for symmetry would be unverifiable scope
creep in this PR.

**Blast radius.** `deriveWatchLevels()` has exactly one caller, `SpxCommentaryRail.tsx` (the live
"Largo" commentary rail on the SPX desk) — no second call site to check for duplicated logic.

**Tests.** `src/lib/bie/spx-live-voice.test.ts`, `describe("deriveWatchLevels")`: added two tests —
the broken-down repro above (asserts `side === "above"`, the line does NOT match `/reclaimed/i`,
and DOES match `/now resistance/i`) and a sibling test for the not-yet-broken case (`pdl: 7490`,
`side === "below"`) asserting the forward-looking "lose it" text is unchanged by the fix. RED→GREEN
proven via `git stash push -- src/lib/bie/spx-live-voice.ts`: pre-fix, 1/56 tests in the file failed
(the new broken-down-PDL test, byte-for-byte the live-repro assertion failure); post-fix (stash
pop), 56/56 pass. Collateral: `spx-live-voice.guard.test.ts` + `spx-commentary.test.ts` both green
(25/25). Full repo suite (Node 20): 16043 pass / 0 fail / 3 skipped. `npx tsc --noEmit` clean.
