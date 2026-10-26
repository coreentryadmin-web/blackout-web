> **kind:** `FINDING`

## SPX Slayer closed-market SCANNING card computed confluence off a cold-cache bootstrap shell — `assessed:true` with an empty `factors: []`, no real grade behind it — FIXED

| **Status** | Fixed |
|---|---|

### Area

SPX Slayer — closed-market (`!market_open`) `SCANNING` branch of `evaluateSpxPlayCore`
(`src/features/spx/lib/spx-play-engine.ts`), the member-facing dashboard's "session closed"
card.

### Root cause

The branch gated computing a closing confluence read on `desk.price > 0` alone:

```ts
const closedConfluence = desk.price > 0 ? computeSpxConfluence(desk) : null;
...
assessed: closedConfluence != null,
```

`computeSpxConfluence` (`spx-signals.ts`) only refuses with `null` on `!price || price<=0 ||
!desk.available` — otherwise it builds `factors[]` from a sequence of independent
`if (desk.X != null)` checks and always returns a non-null object, even with `factors: []` and
`score: 0`, when every signal field is absent.

A cold-cache **bootstrap shell** — built by `buildBootstrapFastLane()` /
`deskShellFromPulse()` (`spx-desk-loader.ts` / `spx-desk.ts`) whenever the merged-desk cache
misses right after the per-day `spx-merged:${date}` key rolls over at ET midnight — is exactly
this shape: a real `price` from the lightweight pulse layer, `available: true` (`mergePulseIntoDesk`
reassigns `available: pulse.available || base.available`, fixed earlier under task #145/PR
#6711), but **no GEX/flow layer ever merged in**, and `source` left at its documented `"none"`
degraded-shell marker (see the comment block in `spx-desk-merge.ts`'s `mergePulseIntoDesk`/
`mergeDeskLayers` — `mergePulseIntoDesk` never reassigns `source`). `computeSpxConfluence`'s
`!desk.available` guard doesn't catch this shape at all, so it returned an empty-but-non-null
confluence object instead of `null`.

### Impact

`assessed: closedConfluence != null` then read `true` off that empty object, and the three `??`
fallbacks (`grade`, `score`, `rawScore`) rendered their *placeholder* defaults (`"D"`, `0`, `0`)
as if they were a real closing grade. The dashboard's own existing code comment already warns
these three fields are placeholders "off-hours the desk may have no confluence to close out
on" — but `assessed` was the one field claiming otherwise, telling the member the session had
actually been graded when the desk never built a real read on it at all.

### Fix

Gate `closedConfluence` on `desk.source !== "none"` as well as `desk.price > 0`, so the
bootstrap/degraded shell correctly falls through to `assessed: false` (and the `??` fallbacks
render as the acknowledged placeholders they already are) instead of fabricating an empty-factor
grade.

### Blast radius

Single call site — this is the only place in `spx-play-engine.ts` that calls
`computeSpxConfluence` directly off a desk without first checking it came from a real merged
build. The live-open-market `evaluateOpenPlay` path (`market_open: true`) is unaffected: a
`market_open: true` desk is never served by `buildBootstrapFastLane` once a real merge
completes, and that whole branch is gated on `!desk.market_open && !premarket` before this code
even runs.

### Evidence the fix works

Found via the `five-engine-largo-cycle-24` Workflow's correctness sweep (6-agent Check phase +
2-vote adversarial Verify phase) against the live source, then traced end-to-end by hand through
the real `buildBootstrapFastLane`/`deskShellFromPulse`/`mergePulseIntoDesk`/`mergeDeskLayers`/
`computeSpxConfluence` implementations before writing the fix, to confirm the exact mechanism
rather than trusting the workflow's prose summary.

RED→GREEN, new regression test in `src/features/spx/lib/spx-play-engine.test.ts`
("`evaluateOpenPlay closed-market SCANNING, bootstrap-shell desk (source:none): assessed is
false, not a confluence computed off an empty shell`"): constructs a `desk()` fixture with
`market_open: false, source: "none"`, a real price, no open play seeded, and every GEX/flow
signal field left null — confirmed it fails pre-fix (`assessed === true`, the exact reported
bug) and passes post-fix (`assessed === false`, `factors: []`). Full suite + `npx tsc --noEmit`
run clean on Node 20 alongside this change.
