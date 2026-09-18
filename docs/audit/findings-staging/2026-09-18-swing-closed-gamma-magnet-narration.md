> **kind:** `FINDING`

## Ask Largo swing brief's gamma magnet level was structurally present but narrated in NO prose section for CLOSED plays — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo play-brief (`src/lib/swing/play-brief-intel.ts`) — found via the Ask Largo standing mandate's 5-engine health-check deep-dive |
| **Severity** | P2 (a real, computed Vector level silently absent from every prose section of a CLOSED play's brief while still appearing in the structured `levels`/"Key levels" array — a genuine narrative gap, not an honest absence) |
| **PR** | fix/swing-closed-gamma-magnet-narration |

### Root cause

The gamma magnet is narrated in prose via `magnetCoaching` (`play-brief-narrative-coaching.ts`),
called from `collectCoachingBullets` — but `collectCoachingBullets` early-returns
`closedCoaching(play)` alone for `bucket === "closed"` and never reaches `magnetCoaching`:

```ts
if (bucket === "closed") {
  push(closedCoaching(play));
  return out;
}
```

`chartLevelsSection` ("Levels on chart") already narrates every OTHER Vector-derived level
(call/put wall, gamma flip, GEX king strike, max pain, expected move, nearest wall, confluence
nodes, dark pool levels) regardless of bucket — none of those lines gate on `statusBucket`. The
gamma magnet was the one exception: structurally present in the structured `levels` array (via
`play-brief.ts`) but narrated in no prose section anywhere for a CLOSED play.

Live repro (real production data via an authenticated Clerk session), confirmed independently on
TWO separate CLOSED plays across two audit cycles: NRG #34 and CG #25 — both carried a magnet
level in the structured envelope with zero prose mention.

### Evidence

- `play-brief-narrative-coaching.ts` (`collectCoachingBullets`): confirmed the early-return exactly
  as described — `bucket === "closed"` never reaches `magnetCoaching`.
- `play-brief-intel.ts` (`chartLevelsSection`): confirmed every other Vector-derived level line
  renders unconditionally (no `statusBucket` gate) — the magnet was the sole omission.

RED→GREEN proof (independently reproduced on a fresh `fix/swing-closed-gamma-magnet-narration`
branch off actual latest `origin/main`):
- This sandbox's `tsx --test` run on this specific 4000+-line test file proved intermittently slow
  to the point of hanging (multi-minute CPU-bound stalls with zero progress past the TAP header) —
  reproduced independently, container-resource-specific, not tied to this fix (both pre-fix and
  post-fix states hung at least once; both also completed cleanly on other attempts, in ~530-830ms).
  Worth a `CLAUDE.md` environment note if it recurs on other large test files.
- Built an isolated standalone harness (`tsx` importing `chartLevelsSection` directly, bypassing the
  full test file) to get a clean, unambiguous RED→GREEN: pre-fix, a CLOSED play with only a magnet
  in its Vector state returned a `null` section (the magnet was the ENTIRE bug — no line rendered at
  all). Post-fix, the same input renders `"Gamma magnet: 40.63 — +1.1% ($0.46 from spot)"`. An OPEN
  play with the identical Vector state returns `null` in both pre- and post-fix states, confirming no
  duplication was introduced on the bucket that already gets the magnet from `magnetCoaching`.
- Once the sandbox test run completed cleanly (not every attempt): `npx tsx
  --experimental-test-module-mocks --test src/lib/swing/play-brief-intel.test.ts` — **164/164 pass**.
  Broader `play-brief*.test.ts` sweep: **640/640 pass**.
- `npx tsc --noEmit -p .` on Node 20: clean.

### Blast radius

Single-file fix: `chartLevelsSection`'s new CLOSED-only branch. `magnetCoaching`'s existing
OPEN/WATCH behavior (`play-brief-narrative-coaching.ts`) is untouched — the fix is scoped so it
cannot duplicate that line on the buckets that already carry it.

### Fix rationale

Minimal, targeted: added a "Gamma magnet" line to `chartLevelsSection`, gated on
`statusBucket(ctx.play) === "closed"` specifically so OPEN/WATCH (which already get the magnet,
with richer actionable framing, from `magnetCoaching`) never see it twice — the exact duplication
class this same file's own "Nearest wall" comment already warns against.

### Verification

Independently re-verified from scratch on a fresh branch off actual latest `origin/main` — the
claimed early-return in `collectCoachingBullets` and the unconditional rendering of every sibling
level line in `chartLevelsSection` were both grep-verified at their exact locations; RED/GREEN
reproduced independently via an isolated direct-import harness (to route around this sandbox's
intermittent slowness on the full test file) and, separately, via the real test file once it
completed cleanly; broader `play-brief*.test.ts` sweep and `tsc --noEmit` both clean.
