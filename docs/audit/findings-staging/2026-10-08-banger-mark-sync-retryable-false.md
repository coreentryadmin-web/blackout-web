## 2026-10-08 — [FINDING, largo-swing] A never-synced option mark's C3 absence chip was hardcoded `retryable: false` on a premise that went stale a month earlier — FIXED

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (no wrong number served — the "Mark: unknown" prose and the structured chip's `reason`/`what_is_missing` were already correct; only the `retryable` flag itself was wrong, telling the model/UI that re-asking is permanently pointless when it is not) |
| **Component** | `src/lib/swing/play-brief-absence.ts` (`collectOptionMarkStalenessAbsence`) |
| **PR** | fix/banger-mark-sync-retryable |
| **Found via** | Ask Largo standing sub-mandate — this cycle's 5-engine live monitor, tracing an anomaly surfaced while validating Swing health: `GET /api/market/nighthawk/horizons?view=SWING`'s committed-position array showed a clean, reproducible split (first 74 of 107 live positions `contract.mid: null`, remaining 33 real) that traced to the 74-row BANGER batch `banger-discovery` committed at 20:15:23-20:15:30Z this session (the same batch the prior :50 cycle had already root-caused as non-anomalous). Confirmed via `GET /api/market/swing/play-brief` for two fresh tickers from that batch (RILY `positionId=1645`, PHAT `positionId=1644`) against `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s C3 (absence) point. |

### Root cause

`collectOptionMarkStalenessAbsence`'s `markIsSync === true` branch (a position whose `markAsOf` is
genuinely null — never synced even once) hardcoded `retryable: false`, with a comment reasoning
"banger-lane rows have no mark_as_of column at all... not something a retry of THIS read can fix."
That premise was true before **FINDINGS 2026-09-11**, which added `banger_positions.last_mark_at` /
`row.last_mark_at` specifically so this lane could carry a real sync timestamp (confirmed in
`src/lib/banger/positions-db.ts` and forwarded in `horizonPlayFromBangerPosition`,
`src/lib/swing/banger-lane-merge.ts`) — but the `retryable: false` hardcode in
`play-brief-absence.ts` was never revisited after that sibling fix landed, so it kept asserting a
structural dead end that the very column it cited as missing had since been added to fix.

### Evidence

Live `GET /api/market/nighthawk/horizons?view=SWING` (2026-10-08, ~21:32 UTC / post-close): of 107
live (MANAGING/SCALING_OUT/EXITING) Swing positions, indices 0-73 (all 74 rows with
`firstSeenAt`/`committedAt` in the `2026-10-08T20:15:2Xs` window — this session's BANGER commit
batch) carried `contract.mid: null, bid: null, ask: null, openInterest: 0, markAsOf: null` with
**zero exceptions**; indices 74-106 (all rows committed on an EARLIER session day) carried a real
`mid` with `markAsOf: "2026-10-08T20:00:44.5XXZ"` — i.e. stamped by the last `banger-live-sync` RTH
tick, which ran *before* the new batch existed (`banger-live-sync` self-skips outside
`isEtCashRth()`, so it had already stopped ticking for the day when `banger-discovery` committed the
new batch 15 minutes after the close).

`GET /api/market/swing/play-brief?playId=SWING:RILY&ticker=RILY&positionId=1645` (one of the 74)
correctly rendered the honest prose — `"Mark: **unknown** _(sync quote, no live price yet — do not
read as flat)_"` — and the structured chip:

```json
{
  "source": "option mark",
  "reason": "sync quote without freshness timestamp",
  "what_is_missing": "a live option-quote sync with a mark_as_of timestamp",
  "retryable": false
}
```

`retryable: false` is the one field that was wrong: the SAME position, read again after
`banger-live-sync`'s next on-schedule RTH tick (tomorrow's market open, since today's is over),
WILL carry a real `markAsOf` — exactly as the 33 earlier-session-day rows already demonstrate for
this same lane. Native (non-banger) `swing_positions` rows hit this identical branch for the
identical reason (a position committed between `swing-active-refresh`'s own 15-min RTH-gated
ticks) and resolve the same way, so this was never banger-specific in practice — only the
(now-stale) comment's reasoning was.

### Fix rationale

Changed `retryable: false` to `retryable: true` for this one branch, with a comment explaining the
2026-09-11 premise change and why "the lane's own next scheduled refresh resolves it" is the same
"wait for more data" shape this file's own GEX `insufficient_data` chip already treats as
`retryable: true` (as opposed to the genuinely structural `net_short_everywhere` chip, which stays
`false` because it IS the answer, not a missing fetch). No change to `reason`/`what_is_missing` —
both remain accurate descriptions of the CURRENT state; only the forward-looking "will asking again
ever help" flag changes. Left `optionMarkIsStale`'s separate branch (an aged-but-present `markAsOf`)
untouched — that one was already correctly `retryable: true`.

**Blast radius:** `collectOptionMarkStalenessAbsence` is the only place this chip's `retryable`
value is set (`src/lib/swing/play-brief.ts` and `play-brief-narrative-coaching.ts` both reference
the `reason` string for prose but don't redefine `retryable`), so one fix point covers every
consumer: the play-brief's structured `unavailableSources` array (and therefore anything Largo or
the UI derives from it) for every lane (banger and native) and every OPEN/HOLD/TRIM play currently
in this sync-pending state.

### Evidence that the fix is real (RED → GREEN)

Added a new test (`collectBriefUnavailableSources: unsynced option mark is retryable, not
permanently stuck`) asserting `retryable === true` for a `markIsSync: true, status: "OPEN"` play.
Ran it against the pre-fix code: failed with `false !== true` (`AssertionError`, expected `true`,
actual `false`) — the exact RED this fix closes. After the one-line `retryable: true` change: full
`src/lib/swing/play-brief-absence.test.ts` suite 84/84 pass (was 83/83 before the new test; no
regressions). `npx tsc --noEmit` clean. Full `npm test` run in progress at write time — recorded in
the PR once green.
