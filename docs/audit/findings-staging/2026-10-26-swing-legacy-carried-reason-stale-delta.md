> **kind:** FINDING

# Swing Legacy-carried WATCH reason string kept citing a stale delta after its backing quote was nulled

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | Night Hawk Swings — Legacy-promoted WATCH candidates (`legacy-confirm-promote.ts`) |
| **Severity** | P3 — member-visible self-contradiction, not an engine/gate defect |

## Root cause

`refreshCarriedLegacyPlay` (`src/lib/swing/legacy-confirm-promote.ts`) recomputes a Legacy-carried
WATCH play's calendar DTE each session. When no same-contract fresh quote is available from
today's organic scan and the DTE label has drifted (`staleDte`), a 2026-10-20 fix (same file)
correctly nulls `mid`/`bid`/`ask`/`delta`/`gamma`/`theta`/`vega`/`iv` on the `contract` object — the
documented reasoning being "a stale quote too — drop it honestly... serving confidently-formatted
greeks with zero staleness indication right next to a sibling field the system itself flagged as
untrustworthy was the exact inconsistency this comment already argues against."

That fix only touched the `contract` object. The same function also rewrites the play's
human-readable `reason` string on `staleDte` — but only the DTE count
(`play.reason.replace(/\b\d+DTE\b/g, ...)`). The `reason` string's own delta mention (baked in at
generation time by `contract-ranker.ts`'s `Δ${c.delta.toFixed(2)}` template, e.g. `"C 145 exp
2026-10-30 (7DTE, Δ0.62, OI 1014)"`) was never touched — so after the DTE label updated to reflect
today's real calendar DTE, the delta figure right next to it kept asserting the **original, now
nulled** value as current fact, in the same payload, right next to `contract.delta: null`.

## Evidence

Live repro via `GET /api/market/nighthawk/horizons?view=swings` (2026-10-26, outside RTH):
`board.lanes.SWING.watch` carried three Legacy-promoted candidates with this exact contradiction:

- **MSTR**: `contract.delta: null` (and `gamma`/`theta`/`vega`/`iv`/`mid`/`bid`/`ask` all `null`),
  yet `reason: "C 145 exp 2026-10-30 (7DTE, Δ0.62, OI 1014) · Legacy morning confirm (2026-10-21)"`.
- **PLTR**: same shape — `contract.delta: null`, `reason` still says `"Δ0.59"`.
- **MDB**: same shape — `contract.delta: null`, `reason` still says `"Δ0.60"`.

`openInterest` is correctly NOT part of the stale-null set (it isn't a live quote field the same
way — it's a slower-moving, still-reasonably-current number), so the `OI` figure in `reason` is not
part of this bug; only the `Δ` figure is.

## Fix

Extended the same `staleDte` rewrite to blank the stale delta out of `reason`, falling back to the
same `"—"` convention `contract-ranker.ts` already uses when delta genuinely isn't known at
generation time (`Δ${isNum(c.delta) ? c.delta.toFixed(2) : "—"}`) — consistent vocabulary, not a
fabricated placeholder:

```ts
const reason =
  play.reason && staleDte
    ? play.reason
        .replace(/\b\d+DTE\b/g, `${dte}DTE`)
        .replace(/Δ-?\d+(?:\.\d+)?/g, "Δ—")
    : play.reason;
```

## Blast radius

Single call site — `refreshCarriedLegacyPlay` is the only function in the swing lane that rewrites
a carried play's DTE label in its `reason` string (confirmed: `grep -rn "\\d+DTE\\\\b/g"
src/lib/swing/*.ts` returns exactly one production call site, plus one unrelated strip-not-replace
use in `play-brief-diff.ts` that drops the DTE suffix entirely rather than rewriting it).

## Evidence of fix (RED→GREEN)

New test `refreshCarriedLegacyPlay: a drifted DTE label also blanks the stale delta baked into the
reason string, not just the contract field` (`legacy-confirm-promote.test.ts`), sibling fixture to
the existing EWY staleDte test but with a `Δ`-bearing reason string matching the real live shape.
Confirmed RED pre-fix (temporarily stashed the `legacy-confirm-promote.ts` change, kept the test —
1 failure), GREEN post-fix (34/34 pass in the file's own suite).

`npx tsc --noEmit` clean. Full `npm test` (Node 20) run in progress at time of writing.

## What was deliberately left unchanged

The `OI` figure in `reason` is untouched — openInterest is not part of the staleDte null-set on the
`contract` object either, so leaving it in the text matches the contract object's own treatment.
