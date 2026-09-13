> **kind:** FINDING

## Legacy `options_play` year-inference used real "now" instead of the edition's publish date — wrong OCC when reopening an old edition — FIXED

| | |
|---|---|
| **Status** | FIXED (PR — see branch `fix/legacy-options-play-year-inference-historical-view`) |
| **Area** | Night Hawk Legacy — OCC contract resolution |
| **Severity** | P2 (silent wrong-contract resolution for a real, live UI feature; only reachable when viewing an old edition) |
| **Found by** | Night Hawk Legacy standing audit mandate, 20:36 UTC cycle, 2026-09-13 |

### Root cause

`formatOptionsPlay` (deterministic-edition.ts) builds the member-facing `options_play` string via
`shortExpiry()`, which **deliberately strips the year** — e.g. `"NVDA $180 CALL @ $4.00 — Aug 28"`.
This is fine for display, but `resolveLegacyPlayOcc` (legacy-play-contract.ts) → `parseOptionsContract`
(option-contract-parse.ts) has to reconstruct a full OCC symbol (ticker+YYMMDD+type+strike) from that
same string to fetch a live option mark, and a full OCC needs a year.

`parseOptionsContract`'s label-based branch inferred the year from **real wall-clock "now"**
unconditionally:

```ts
const today = new Date();          // always "now", never the play's own context
...
if (parsed < today) {
  parsed = new Date(`${label} ${day}, ${year + 1} ...`);  // roll to next year
}
```

The heuristic ("assume current year; if that reading is already in the past relative to today,
it must mean next year") is only valid when parsing happens close to when the play was published —
true for every existing call site *except* one: the Legacy edition **calendar strip**
(`legacy-board-calendar.ts`'s `legacyEditionSessionDates`, up to 14 trading days back) lets a member
reopen an OLD edition via `selectedEditionDate` in `containers.tsx`. `terminalPlayFromEdition`
(adapters.ts) re-parses that old edition's `options_play` text **fresh on every view**, anchored on
real "now" — not on when the edition actually published.

For a play that already expired weeks ago, "the label reads as before real-today" is true for
**almost any** month/day in the past, so the old code rolled it a full year **forward**, resolving
an OCC for a contract that was **never the actual trade** — a completely different, wrong-year
contract that, for a liquid underlying with matching weekly/monthly strikes, can resolve to a real,
live Polygon quote and silently render a plausible-looking but wrong live P&L/mark for a historical
position.

### Evidence

Reproduced directly with the pre-fix logic (see PR test additions): a play published 2026-08-24
with label "Aug 28" (real expiry `2026-08-28`), re-parsed with real "now" = 2026-09-13, resolved to
`2027-08-28` — one year off. Confirmed via new unit tests in `option-contract-parse.test.ts`,
`legacy-play-contract.test.ts`, and `adapters.test.ts` (all RED before the fix, GREEN after).

### Blast radius

- `parseOptionsContract` (option-contract-parse.ts) — the shared parser, used by every consumer.
- `resolveLegacyPlayOcc` (legacy-play-contract.ts) — the only caller of the label-inference branch
  with a genuinely stale-reparse call site.
- `terminalPlayFromEdition` (adapters.ts) — the one production call site reachable via the calendar
  strip (`containers.tsx`'s `selectedEditionDate`).
- The other two callers (`fetchLegacyDiscordLiveRows` in db.ts, `legacy-discord-trade-notify.ts`)
  are scoped to `outcome = 'pending'` / still-open positions only — always resolved close to
  publish, so they were never exposed to this bug and needed no behavior change (they keep the
  default `referenceDate = new Date()`).

### Fix rationale

Threaded an optional `referenceDate` parameter through `parseOptionsContract` →
`resolveLegacyPlayOcc`, defaulting to real `new Date()` everywhere (so the two live-position call
sites are unaffected). `terminalPlayFromEdition` now passes the edition's own `published_at`
(already available on `EditionDeckSource`, already used elsewhere in the same function) via a new
`publishedAtRef()` helper that falls back to `undefined` (real now) on an absent/unparseable
timestamp rather than ever handing a NaN Date downstream.

Considered instead: storing the OCC directly in the DB at publish time so it never needs
re-parsing. Deliberately not done here — that's a real improvement but a larger, riskier schema
change; anchoring the existing pure-function inference on data already on hand (`published_at`)
fixes the actual defect with the smallest possible diff.

### Verification

- New tests RED before the fix, GREEN after (`option-contract-parse.test.ts` ×2,
  `legacy-play-contract.test.ts` ×1, `adapters.test.ts` ×1).
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20): 14119 pass / 0 fail (post-fix).
