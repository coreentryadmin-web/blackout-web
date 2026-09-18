> **kind:** FINDING

## Legacy option-mark staleness uses 0DTE's 5s threshold; a Legacy-specific 30s constant exists but is fully unused

| | |
|---|---|
| **Status** | OPEN — reported per the standing escalation policy (ambiguous calibration/product judgment call, not a small/unambiguous fix) |
| **Lane** | Night Hawk Legacy |
| **Severity** | P3 — live, member-facing, but cosmetic (a freshness label only; price/mark values themselves are unaffected) |
| **Found by** | NIGHT HAWK LEGACY audit lane, 2026-09-14, via 3 consecutive ~15-min healthcheck cycles (13:37/13:51/14:08 UTC) |

### What's wrong

`GET /api/market/nighthawk/legacy-marks` (Legacy's live option-mark feed, polled by the member
UI every 2.5s via `useLegacyOptionMarks`) computes its `stale` flag with
`src/features/nighthawk/lib/legacy-option-mark-row.ts`'s `buildLegacyOptionMarkRow`:

```ts
const stale =
  mark == null || !Number.isFinite(mark) || mark <= 0 || asofMs == null ||
  isZeroDteMarkStale(asofMs, nowMs);
```

`isZeroDteMarkStale` is called with only two arguments, so it falls back to its third
(default) parameter:

```ts
// src/lib/zerodte/marks-math.ts
export function isZeroDteMarkStale(
  asOfMs: number,
  nowMs: number,
  staleAfterMs = ZERODTE_MARK_STALE_MS   // = 5_000 ms
): boolean { ... }
```

`ZERODTE_MARK_STALE_MS` (5 seconds) is tuned for 0DTE — same-day contracts with rapid decay,
where the member UI needs a tight freshness bar. Legacy is a **next-day swing product**; its own
`marks-math.ts` already carries a constant that reads as purpose-built for exactly this:

```ts
/** Legacy plays poll stock quotes via REST every 5s; 30s without an update = stale. */
export const LEGACY_QUOTE_STALE_MS = 30_000;
```

**`LEGACY_QUOTE_STALE_MS` has zero non-definition references anywhere in the repo** (verified
`grep -rn "LEGACY_QUOTE_STALE_MS" --include="*.ts" src`, including test files — only the
definition line in `marks-math.ts` matches). It is dead code: defined, commented with clear
intent, and never wired into any consumer — not the option-mark row builder above, and not
`src/features/nighthawk/command-deck/use-legacy-quotes.ts` (Legacy's stock-quote poller, which
does run on exactly the 5s cadence the comment describes, confirmed via its own
`const POLL_MS = 5_000`) either. That hook computes no staleness flag at all client-side.

### Live evidence

Three consecutive ~15-minute-apart runs of `npm run healthcheck:legacy -- --json` (this session,
2026-09-14, 13:37 / 13:51 / 14:08 UTC) all showed the same evidence for DELL's live 2026-09-14
Legacy play (`DELL260918C00570000`, a mega-cap, liquid, near-the-money-ish contract — not a
thin/illiquid name):

```
"occ": "DELL260918C00570000",
"verdict": "AMBER",
"evidence": "mark flagged stale by the API"
```

Pulling `GET /api/market/nighthawk/legacy-marks?occs=DELL260918C00570000` directly (authenticated,
same session) confirmed the mark itself is sane and not the problem:

```json
{
  "occ": "DELL260918C00570000",
  "mark": 5.93,
  "bid": 5.65,
  "ask": 6.2,
  "asof": "2026-09-14T14:08:09.694Z",
  "stale": true
}
```

`mark` sits correctly inside `[bid, ask]` — this is a real, tradeable, two-sided quote. It is
flagged `stale` purely because its quote-clock age (`nowMs - asofMs`) exceeded 5 seconds by the
time of read, which — given Legacy's own 5s REST poll cadence (`use-legacy-quotes.ts`'s
`POLL_MS`) and typical network/render latency on top of it — is a bar a perfectly healthy,
liquid Legacy contract can trip routinely, not just during genuine provider outages.

### User-facing impact

`row.stale` is not just an audit-script artifact — it flows directly into the live member UI:

```ts
// src/features/nighthawk/command-deck/use-legacy-option-marks.ts, overlayLegacyOptionMarks()
markIsSync: row.stale,
```

with the function's own adjacent comment acknowledging the underlying tension without resolving
the threshold question: *"Use REST-backed marks even when WS is quiet (weekly names). Stale only
affects freshness label."* So the practical impact today is soft — members see a "stale/delayed"
freshness badge on real, correctly-priced positions more often than the underlying data quality
actually warrants, not a wrong price or a blocked action. But it is a real, live, reproducible
member-facing signal that this finding shows is being computed against the wrong lane's tuning.

### Why this is a HELD finding, not a direct fix

The root cause is unambiguous (traced to one line, one default parameter, one dead constant).
The **right fix is not**, for two reasons this lane shouldn't decide alone:

1. **Which value is actually correct for Legacy option marks is a calibration/product judgment
   call**, not a mechanical correction. `LEGACY_QUOTE_STALE_MS`'s own comment scopes it to
   *"Legacy plays poll **stock quotes**"* — it may have been intended for the stock-quote overlay
   (`use-legacy-quotes.ts`, which currently has no staleness check of any kind — a second,
   separate gap this finding surfaces) rather than the *option*-mark overlay reviewed here. It is
   not certain that reusing the same 30s number for option marks is correct just because both are
   "Legacy" — option quotes and stock quotes can have meaningfully different real-world update
   cadences even on the same underlying's chain.
2. **The current 5s default was deliberately tested as recently as 2026-09-13** (this file's own
   `legacy-option-mark-row.test.ts`: `observedAtMs: NOW - 5_000` → asserts `stale: false`, i.e.
   right at the current 5000ms boundary) as part of the `quoteUpdatedMs`-vs-`observedAtMs` fix
   landed that day. Whoever wrote that test may have consciously kept the 0DTE-shared default for
   Legacy rather than overlooking it — this finding cannot rule that out from the code alone, and
   changing shared `marks-math.ts` defaults touches 0DTE's own tuning if done carelessly.

### Suggested resolution (for whoever picks this up — not prescriptive)

- Decide, with real Legacy quote-cadence data (a longer live sample than this finding's 3
  cycles), what an appropriate Legacy option-mark staleness bar actually is — likely wider than
  5s given the 5s REST poll floor plus render/network latency, but the exact number needs
  evidence, not a guess.
- If `LEGACY_QUOTE_STALE_MS` is confirmed as the right value for option marks too, wire it in as
  the third argument to `isZeroDteMarkStale` inside `buildLegacyOptionMarkRow`
  (`isZeroDteMarkStale(asofMs, nowMs, LEGACY_QUOTE_STALE_MS)`) and add/extend a regression test
  proving a ~10-20s-old-but-real Legacy quote reads `stale: false` under the new bar while still
  correctly flagging genuinely old quotes (the existing 45-minute-old fixture in
  `legacy-option-mark-row.test.ts` should stay `stale: true` either way).
  - **Or**, if stock quotes and option marks genuinely warrant different bars, wire
    `LEGACY_QUOTE_STALE_MS` into `use-legacy-quotes.ts`'s stock-quote path (which currently has no
    staleness check at all) and introduce a separate, option-mark-specific constant for
    `legacy-option-mark-row.ts` instead of reusing either existing constant.
- Either way, `legacy-e2e-healthcheck.mjs`'s B_marks stage (`scripts/audit/lib/legacy-healthcheck-eval.mjs`)
  reads the same `stale` field from the same API and needs no change once the underlying threshold
  is corrected — it is accurately reporting the live API's own self-declared staleness, not
  miscomputing anything itself.

### Files involved

- `src/features/nighthawk/lib/legacy-option-mark-row.ts` — the call site defaulting to 5s.
- `src/lib/zerodte/marks-math.ts` — `ZERODTE_MARK_STALE_MS` (used), `LEGACY_QUOTE_STALE_MS` (dead).
- `src/features/nighthawk/command-deck/use-legacy-option-marks.ts` — member UI consumer of `stale`.
- `src/features/nighthawk/command-deck/use-legacy-quotes.ts` — the stock-quote poller
  `LEGACY_QUOTE_STALE_MS`'s own comment describes, with no staleness check wired in at all.
- `src/features/nighthawk/lib/legacy-option-mark-row.test.ts` — existing test pinning the current
  5s-boundary behavior (would need updating alongside any threshold change).
