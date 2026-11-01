> **kind:** FINDING

## UW dark-pool normalizers (`fetchUwDarkPool`, `fetchUwDarkPoolMarketWide`, `normalizeDarkPoolWsPayload`) still truncate `executed_at` to 19 chars — the sibling-propagation fix that landed on `option_trades`/`lit_trades` normalizers never reached this 3rd/4th/5th sibling — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** round-269 discovery-lane sweep of `src/lib/providers/unusual-whales.ts`, applying
the "fix shipped for one consumer, never propagated to a structurally identical sibling consumer"
vein that previously found the same defect on `normalizeLitTradesWsPayload` (merged earlier). That
earlier fix's own in-code comment ends with "Same defect `normalizeOptionTradesWsPayload` (above)
was fixed for, never propagated to this sibling" — this round re-walked the file's remaining
`executed_at ?? ... ?? ""` producers to check whether every sibling actually got the fix. Three did
not: `fetchUwDarkPool` (REST, `/api/darkpool/{ticker}`, line ~1172), `fetchUwDarkPoolMarketWide`
(REST, `/api/darkpool/recent`, line ~1227 pre-fix), and `normalizeDarkPoolWsPayload` (WS,
`off_lit_trades` channel, line ~1314 pre-fix) all still built their `DarkPoolPrint.executed_at`
field via `execAt.slice(0, 19)`.

**Root cause:** identical to the already-fixed siblings. `execAt` is a UW-supplied ISO-8601
instant (verified by `src/lib/et-date.ts`'s `execAtEtYmd`, which explicitly handles a bare date, a
`T`-separated ISO string, and a space-separated timestamp, appending `Z` only when parsing an
already-Z/offset-less string for its OWN same-day filter — i.e. the upstream shape genuinely
carries a timezone marker). Slicing to 19 characters keeps exactly `"YYYY-MM-DDTHH:MM:SS"` and
drops everything after it:
- On a Z-suffixed timestamp with no sub-second component (`"2026-06-30T15:04:00Z"` → 20 chars),
  slicing strips the trailing `"Z"`, leaving `"2026-06-30T15:04:00"` — which `new
  Date()`/`Date.parse()` then parse as **local time**, not UTC. Silently correct only because
  production runs a UTC container; silently wrong the moment it does not.
- On UW's real microsecond-precision shape (`"2026-08-21T20:14:37.211537Z"`, captured live and
  documented on the sibling `created_at` field in `flow-timestamp-epoch.test.ts`), slicing drops
  the fractional seconds AND the `"Z"` at once.

This is the same UW WS transport family as `lit_trades`/`option_trades` (`off_lit_trades` is the
dark-pool sibling channel), parsing the identical `r.executed_at ?? r.date ?? r.timestamp` shape —
exactly the pattern the earlier fix's own comment calls out, just never checked against these three
call sites in the same file.

**Blast radius — every downstream reader that re-parses `DarkPoolPrint.executed_at` with
`new Date()`/`Date.parse()` inherited the truncated value:**
- `src/lib/uw-lit-dark-ratio.ts`'s `latestPrintAgeMs()` — `Date.parse(p.executed_at)`, used to
  decide whether a caller-resolved dark-pool snapshot counts as "fresh" for the lit/dark ratio
  metric (`computeLitDarkRatio`).
- `src/lib/discord-eod-recap.ts` — `new Date(p.executed_at).getTime()` (twice), used for the
  end-of-day Discord recap's dark-pool section.
- `src/features/helix/lib/helix-coord-window.ts` — `new Date(dp.executed_at).getTime()`, the
  flow/dark-pool "coordinated prints" time-window check.
- `src/lib/darkpool-discord-format.ts` — `new Date(print.executed_at)` (multiple sites), the
  live Discord dark-pool alert formatter.

All three fixed sites feed these consumers: `fetchUwDarkPool`/`fetchUwDarkPoolMarketWide` are the
REST path the SPX desk (`spx-desk.ts`'s `resolveDarkPool()`) and Meridian earnings intel read;
`normalizeDarkPoolWsPayload` feeds the live `darkPoolStore` (`uw-socket.ts`) that
`uw-lit-dark-ratio.ts`, the SPX pulse SSE stream, and the Redis WS-cache bridge all read directly.

**Fix:** removed `.slice(0, 19)` at all three sites, keeping `executed_at` verbatim — identical
fix shape to the two already-merged siblings, with an in-code comment on each explaining why (and
cross-referencing the other two) so a future sweep doesn't have to re-derive this a fourth time.
Deliberately left unchanged: the `execAtEtYmd`-based same-session-day filter (unaffected — it reads
the untruncated `execAt` *before* the slice, so it was never the broken half), and every downstream
comparison site that does its own `.slice(0, 19)` at the point of comparison (e.g.
`helix-flow-deep-link.ts`'s dedupe-key matching) — those slice both sides of a comparison
consistently and are unaffected by the source value being longer now.

**Fix rationale:** verbatim passthrough (not re-formatting or re-parsing `execAt`) matches the
precedent set by the two already-fixed siblings exactly, so all three dark-pool producers and the
two trade-tape producers now agree on one convention for this field across the whole file.

**Evidence (RED → GREEN):** added a regression test to `src/lib/providers/uw-ws-normalize.test.ts`
— `normalizeDarkPoolWsPayload keeps executed_at VERBATIM — does not strip the UTC 'Z' or
sub-second precision` — using a microsecond-precision ISO timestamp dated "today" (ET) so the
function's own same-day filter doesn't drop the row before the truncation bug is reached. RED
(pre-fix): `actual: '2026-11-01T10:38:51'` vs `expected: '2026-11-01T10:38:51.211537Z'` —
assertion failure, 1/9 tests failing in that file. GREEN (post-fix): 9/9 pass. Also ran the full
sibling suite (`unusual-whales.test.ts` + `uw-ws-normalize.test.ts` +
`src/lib/uw-lit-dark-ratio.test.ts` + `src/lib/darkpool-discord-format.test.ts`): 58/58 pass.
`npx tsc --noEmit`: clean.
