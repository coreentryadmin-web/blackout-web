## SPX Slayer `resolveLeanDirection()` fabricates a "Puts lean" from an unknown VWAP — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Area** | SPX Slayer play system (`src/features/spx/lib/spx-play-intel.ts`) |
| **Found by** | Ask Largo / 5-engine standing monitor, 2026-10-24 ~20:11 UTC cycle, live GET `/api/market/spx/play` |

### Symptom

During a closed-market session (Saturday, `session_phase: "closed"`), the SPX Slayer play payload's `play_idea` text read:

> "Tape's mixed, but Puts lean — 7625 Put on watch · Into 0DTE resistance 7625 (−1 pts)"

— despite the underlying confluence being **completely neutral**: `score: 0` (10 factors summing to exactly zero, independently verified), `direction: null`, `bias: "neutral"`. There was no real directional evidence behind the "Puts lean" wording at all.

### Root cause

`resolveLeanDirection()` (`spx-play-intel.ts`) is the final tiebreaker `buildPlayIdea()` falls through to when the confluence score carries literally no lean information (exactly zero, after the score-sign preference fixed on 2026-09-09). The old final line was:

```ts
return desk.above_vwap ? "long" : "short";
```

`desk.above_vwap` is typed `boolean`, not tri-state. Every writer of it (`spx-desk.ts`'s `vwap != null ? price >= vwap : false`, mirrored in `spx-desk-merge.ts`'s pulse fallback and `usePulseStream.ts`) defaults it to the literal `false` whenever `desk.vwap` itself is unknown (off-hours, pre-open, no sticky/base VWAP to fall back to either) — `false` there means "we have no idea," not "price sat below VWAP." Live confirmed: at the time of the repro, `desk.vwap: null` and `desk.above_vwap: false` on the SAME payload.

Reading that `false` unconditionally as a real signal turned "we don't know" into a confident "short" pick — the exact same failure class this codebase has fixed repeatedly elsewhere (task history: "VWAP side fabricating 'below' when spot unknown," play-brief-intel.ts, swing lane) — just not yet at this particular SPX-lane call site.

### Blast radius

Checked every other read site of `desk.above_vwap` (`grep -rn "\.above_vwap\b"`): `anchorPhrase` (two functions below, in the same file), `spx-play-terminal-lines.ts`, `spx-play-intel.ts`'s own `anchorPhrase`, `spx-play-confirmations.ts`'s gated sites, `SpxIosMarketStrip.tsx`'s UI chip, and `spx-signals.ts`'s scoring factor are all already gated on `desk.vwap != null` before trusting the boolean — `resolveLeanDirection`'s final fallback was the one unguarded consumer.

### Fix

Gate the fallback on `desk.vwap != null` (mirroring `anchorPhrase`'s own convention two functions down), computing the comparison directly from `desk.price`/`desk.vwap` rather than trusting the possibly-fabricated `above_vwap` field. When VWAP is *also* unknown, fall back to the day's real price change (`desk.spx_change_pct`) — a genuinely computed number, never a coerced placeholder — before a final, explicitly-commented last-resort default for the (extremely degenerate) case where neither is available.

### Evidence

- RED→GREEN: new test `"buildPlayIdea does not fabricate a short/Puts lean from a null VWAP's coerced above_vwap=false (live repro 2026-10-24)"` in `spx-play-intel.test.ts` fails against the pre-fix source (`git stash` of only `spx-play-intel.ts`) with `actual: 'short'` vs `expected: 'long'`, passes after the fix.
- `npx tsx --experimental-test-module-mocks --test src/features/spx/lib/*.test.ts` → 864/864 pass (Node 20).
- `npx tsc --noEmit` → clean.
