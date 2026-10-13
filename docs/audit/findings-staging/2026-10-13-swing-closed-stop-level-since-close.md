## 2026-10-13 — [FINDING, P3 product/Largo, Night Hawk Swings] "Since it closed" never answered whether a stop-out was confirmed or reversed — FIXED

> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| `src/lib/swing/play-brief-intel.ts` (`watchForSection`, closed bucket — the Ask Largo swing play-brief) | P3 — missing narrative richness, no incorrect data shipped | FIXED |

**What's missing.** Live-sampled several real production CLOSED play-briefs (AMD, MSFT, INTC, BE)
during a routine Ask Largo deep-dive. Every one of them, in the "Since it closed" section, told
the member where spot currently sits vs the gamma flip and vs a live structural (GEX/dark-pool)
level — but never the single most tactically relevant fact for a **stopped-out** position: has the
underlying kept moving in the stop's direction since the exit (confirming the stop was right), or
has it reversed back through the stop level (meaning the exit may have been early)? Example, real
AMD CLOSED brief: entry $611.09, stop/invalidation $595.99, exited -57.1%, and "Since it closed"
only said "Structural support node: put wall 560.00" — leaving the member to manually compare
today's spot ($590.00, shown elsewhere in the same brief under "Chart technicals") against the
$595.99 stop level themselves to answer the question at all.

**Why this gap existed.** `play.invalidationUnderlyingPx` (the exact stop/thesis-invalidation
underlying price the position closed under) is pinned at commit and stays valid post-close — it's
the identical field `closedCoaching`'s "Stop fired... a X% cushion at commit" line already reads
(play-brief-narrative-coaching.ts) — but that line answers a *different* question (was the entry
already extended relative to the stop AT COMMIT TIME). Nothing compared that same pinned level to
the CURRENT spot `watchForSection` already resolves for its gamma-flip/structural-level lines a few
lines above. The data was already present on both sides; it just was never joined.

**Fix.** Added one gated line to `watchForSection`'s closed-bucket branch, firing only when
`play.closedReason` is `"stopped"`/`"stop"` (a target/time-stop/thesis exit has no "was the stop too
tight" question to answer) and both `spot` and `play.invalidationUnderlyingPx` are known:
- LONG: `spot > invalidation` → "Spot has since reclaimed the stop level... the exit may have been
  early."; otherwise → "Spot remains through the stop level... confirming the exit."
- SHORT: mirrored (`spot < invalidation` is the reclaim case).

Live AMD example with the fix: `spot 590.00 > invalidation 595.99`? No — so it would render "Spot
remains through the stop level (**595.99**) — now **590.00**, confirming the exit." (verified by
hand against the real AMD numbers pulled live before writing the fix, not re-fetched after — the
position's real stop/spot relationship already supports this exact framing).

**Evidence.** Added 3 tests to `play-brief-intel.test.ts`: LONG-reclaimed, SHORT-confirmed, and a
negative case proving the line is omitted for a non-stop close reason (target). RED→GREEN proven
directly — all 3 ran against the pre-fix code first (2 failed on the expected "No gamma flip..."
fallback text, the negative case passed trivially since the code didn't exist yet), then against
the fix (223/223 pass in `play-brief-intel.test.ts`). `tsc --noEmit`: clean.

**Blast radius.** Single function, single file, additive only (no existing line changed or
removed) — does not touch the WATCH/OPEN bucket branches or any other section. No deduplication
risk with `closedCoaching`'s existing "Stop fired... cushion at commit" line since the two answer
different questions (commit-time entry/stop relationship vs current-spot/stop relationship) and
neither mentions the other's framing.

**What was deliberately left unchanged.** Did not extend this to target/time-stop/thesis exits —
"did spot keep moving past my stop" has no equivalent well-posed question for those exit reasons,
and forcing one would read as a non sequitur rather than useful trade-manager context.
