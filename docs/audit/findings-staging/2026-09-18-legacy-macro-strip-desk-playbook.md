> **kind:** FINDING

## Night Hawk Legacy — desk playbook regime line wired into the ACTUAL live macro strip — FIXED

| **Status** | FIXED |
|---|---|

**Root cause / prior gap.** PR #5235 (Task #31) added `desk_playbook` to `market_recap`
(`format.ts`/`edition-builder.ts`) but — after a same-PR self-correction — shipped only the
data-layer half: the live Legacy board (`LegacyPickLogBoard.tsx` → `LegacyMacroStrip.tsx`) does
not read `market_recap` at all. Its `regime`/`gexBias` fields come from a completely separate,
morning-only pipeline: `nighthawk-morning-confirm` cron → `GET /api/platform/intel` →
`LegacyMacroContext` → `LegacyMacroStrip`. `deriveComposite()`'s authored strategy sentence
(`market_regime.playbook`) was already present in `/api/platform/intel`'s `regime.playbook` field
(confirmed by reading the route — no change needed there) but was dropped at the very next hop:
`fetchPlatformIntel()` inside `nighthawk-morning-confirm/route.ts` only ever read
`data.regime.composite`, never `data.regime.playbook`.

**Evidence.** Traced the full pipeline end to end: `/api/platform/intel/route.ts` line
`playbook: regimeRow.playbook` (already correct) → `nighthawk-morning-confirm/route.ts`'s
`fetchPlatformIntel()` (dropped it) → `MorningConfirmResult` (missing the field entirely) →
persisted verbatim to Redis (`nh:play-status:${date}`) → `GET /api/nighthawk/play-status` (spreads
the Redis blob unchanged) → `containers.tsx`'s `confirmData`/`macroContext` useMemo (never read
it) → `LegacyMacroStrip.tsx` (never rendered it). Confirmed `LegacyPickLogBoard`/`LegacyMacroStrip`
are the actually-live components (`command-deck/containers.tsx` line 541,
`nighthawk-boards-preview/NightHawkBoardsPreviewClient.tsx`) — not the dead `PlaybookBoard.tsx`
PR #5235 mistakenly targeted first.

**Blast radius.** Five files: `nighthawk-morning-confirm/route.ts` (`fetchPlatformIntel` return
type + all 3 `MorningConfirmResult` construction sites — normal result, empty/skip result, and the
`fetchPlatformIntel` catch-block fallback — gain `playbook: string | null`), `legacy-macro-types.ts`
(`LegacyMacroContext` type), `command-deck/containers.tsx` (`macroContext` useMemo forwards it),
`LegacyMacroStrip.tsx` (renders it as its own bullet), `morning-status-from-db.ts` (the 24h-Redis-
TTL DB-fallback path honestly returns `playbook: null` — not recoverable from
`morning_verdict.metrics`, which never persisted it, same as the pre-existing `gex_bias`/
`call_wall`/`put_wall` nulls in that same fallback). `computePlayVerdict`'s gating logic (which
reads `intel.regime`, the raw enum) is untouched — `playbook` is purely additive, read by nothing
else.

**Fix rationale.** Minimal, additive, three-line core change (read one more field off an already-
fetched payload, thread it through four already-existing pass-through layers, render it). No new
network call, no new DB read, no schema change. Left the DB-fallback path's `playbook: null` as an
honest gap rather than plumbing a new persistence field through `persistNighthawkMorningVerdicts`
just for this — that would touch the durable per-play verdict schema for a value that's naturally
regenerated fresh every morning anyway (the Redis path is the common case; the DB fallback only
matters after a 24h TTL miss).

**Sample size / evidence.** 5 new unit tests: 1 in `morning-status-from-db.test.ts` (playbook +
gex_bias/call_wall/put_wall all honestly null in the DB-fallback path), 4 in a new
`LegacyMacroStrip.test.ts` (renders nothing when macro is null/empty; renders the playbook sentence
verbatim when present; omits it when absent — never fabricated). No new test for
`fetchPlatformIntel`'s one-line field extraction (unexported helper inside an already-untested
route file — the addition matches the existing untested `gex_bias`/`call_wall`/`put_wall`
extraction lines immediately beside it, not a new gap). `npx tsc --noEmit` clean. Full `npm test`:
14865/14865 passing, 0 regressions.

**Next action.** None required. Closes Task #32. The sentence will render live starting the next
`nighthawk-morning-confirm` cron fire (9:15 ET on the next trading session) once this deploys —
logged to `docs/audit/MARKET-OPEN-VALIDATION.md` as a market-open check.
