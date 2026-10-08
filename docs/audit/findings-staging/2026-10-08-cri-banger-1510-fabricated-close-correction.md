## 2026-10-08 — [FINDING, swing-largo] #5697's fixed-forward fix left an already-corrupted `peak_premium` ratchet live, which then fabricated a real CLOSED trade (+50% / +$27.50) and fired a real Discord alert on it, minutes after the fix deployed — FIXED (data correction, one-off)

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED (production data corrected via `POST /api/admin/run-migration`) |
| **Severity** | P1 (a real, member-facing fabricated "win" was written to the permanent closed-position record and a Discord trade-alert almost certainly fired off it, during live RTH) |
| **Component** | `banger_positions` row id=1510 (CRI, `O:CRI261016C00035000`) — data only; no application code changed in this PR |
| **PR** | fix/cri-banger-1510-peak-correction |
| **Related** | #5697 (fixed the ingest-side cause this morning; this finding is the residue that fix explicitly flagged as unaddressed — "a one-way ratchet with no correction path in the code") |

### Root cause

#5697 (merged 2026-10-08 06:58 PT, same standing Ask Largo audit mandate) fixed
`reliableMarkFromQuote`'s thin-one-lot-ask guard so a bid=0/ask=5.60(size=1) quote on
`O:CRI261016C00035000` is no longer read as a reliable $2.80 mark. That PR's own write-up named
the residual risk explicitly: `peak_premium` is a one-way `GREATEST()` ratchet
(`updateBangerLiveState`, `src/lib/banger/positions-db.ts`) with **no correction path** — the
already-corrupted `2.80` value would survive the fix untouched.

It did. Verified live this cycle: the very next `banger-live-sync` tick after the fix deployed
pulled an honest mark (`0.55`, matching entry — confirmed via
`GET /api/admin/banger/quote-tick-export?occ=O:CRI261016C00035000`, whose last two rows show
`reliable_mark` flipping from the fabricated `2.8` back to `0.55` at `2026-10-08T14:20:45Z`). But
`deriveScaleOutAction` (`src/lib/zerodte/scale-out.ts`) computed retrace-from-peak against the
STILL-corrupted peak: `0.55 / 2.80 = 19.6%`, well under `SCALE_OUT_RULES.trail_from_peak` (50%) —
which fires `EXIT_RUNNER`, not `HOLD`. The position closed one second later
(`closed_at: 2026-10-08T14:20:47.224Z`, confirmed via `GET /api/market/banger/board`'s `closed`
array) with:

```json
{
  "status": "CLOSED_RUNNER",
  "scale_out_action": "EXIT_RUNNER",
  "scale_out_reason": "runner retraced to 50% of peak — close it",
  "realized_pnl_pct": 50,
  "realized_pnl_usd": 27.5
}
```

Both numbers are fabricated: `realized_pnl_pct=50` is `partial(0.55 at the fake 2× tranche) +
remaining-half(0.55 exit) / entry(0.55) - 1`, i.e. it is built entirely out of the fake `2.80` tick
and the (unrelated, honest) `0.55` recovery tick — never out of a real favorable move. `live-sync.ts`
fires `notifyBangerFromScaleOutAction` unconditionally on every status transition (fire-and-forget,
uncaught), so a real Discord trade-alert very likely announced this fabricated win to members within
the same tick.

**Evidence the true outcome was never a win at all**: pulling this contract's ENTIRE tick history
(`banger_quote_tick_log`, every row since commit 2026-10-06) shows `reliable_mark` ranged `0.23–0.55`
across its whole real life — it never reached `SCALE_OUT_RULES.scale_at_mult × entry` (`1.10`, the
TAKE_PARTIAL trigger) and never fell to `hard_stop_mult × entry` (`0.22`, the STOP_OUT trigger; the
real low, `0.23`, was one cent above it). Absent the single fabricated 2026-10-08 13:30–14:15 UTC
tick, this position would still be genuinely OPEN today, flat (0% P&L), never scaled.

### Blast radius

Checked every other field the fabricated transitions touched, not just `peak_premium`:
`scaled_already` (flipped true off the fake 2× tranche — the EARLIER TAKE_PARTIAL transition this
morning, which per #5697's own write-up likely fired its own Discord alert BEFORE that PR was even
deployed), `scale_out_action`/`scale_out_reason`, `partial_realized_premium`,
`realized_pnl_pct`/`realized_pnl_usd`, `status`, `closed_at` — all derived from the corrupted peak,
all corrected together (see the migration file's full list). `trough_premium` was NOT touched (the
bug only ever ratchets the `GREATEST`/peak side; the `LEAST`/trough latch independently recorded the
correct `0.225` throughout — confirmed against the tick log's real low of `0.23`).

Checked whether `src/app/api/market/swing/record`'s win-rate summary (`resolved_chains`/`wins`/
`losses`) picked up this fabricated win: it did not — that route's `closedDeck`/`records` are built
exclusively from `fetchSwingPositionsRange`/`fetchSwingPositionChain` (native `swing_positions`
table); Banger-origin closed positions are structurally invisible to it (only `bangerOpens`, a bare
count, is merged in). So the member-facing Swing track-record stats were never corrupted by this —
only the Banger board's own `closed` array and whatever already-sent Discord alert exists.

**Not fixed by this PR, and out of scope for a sandbox session**: any Discord message that already
announced this fabricated close/partial cannot be edited or deleted from here (no Discord API
access in this toolchain) — flagging for the operator/Cursor to review the `#🤖-banger` (or
equivalent) channel around `2026-10-08T14:20Z` and, if a member-facing alert did go out, consider a
correction post there.

### Fix rationale

Did **not** touch application code — the ingest-side root cause is already fixed by #5697, and
hardening the ratchet itself (e.g., re-validating an existing `peak_premium` against the thin-ask
guard before trusting it in `deriveScaleOutAction`) is a real defensive-coding idea but a separate,
larger change than this one corrupted row needs today; raising it as a follow-up idea on the #4076
collaboration thread rather than bundling it into an urgent data fix.

Instead: a one-off, narrowly-guarded SQL correction
(`src/lib/migrations/016_cri_banger_peak_correction.sql`), applied via the existing
`POST /api/admin/run-migration` admin route (already designed for exactly this — its own doc
comment: "Applies a named SQL migration file... out-of-band SQL files... without restarting the app
or touching runMigrations()"). The correction **reopens** the position to its true, honest state
(status back to `OPEN`, `peak_premium` reset to `0.55` — the real historical max, which equals
entry since this contract never traded above its own entry price — and every derived field cleared)
rather than merely zeroing out `realized_pnl_pct`, because the row's true state absent the bug was
never "closed" at all; leaving it `CLOSED_RUNNER` with a merely-zeroed P&L would still misrepresent
that this position ever reached a terminal state. The WHERE clause is guarded on the row's exact
primary key AND every corrupted field value (`peak_premium=2.8`, `status='CLOSED_RUNNER'`,
`scale_out_action='EXIT_RUNNER'`) so it is a no-op if already applied or if state has since
diverged — see `016_cri_banger_peak_correction.test.ts` (7 tests, RED→GREEN verified via a
deliberately loosened-guard mutation) for an executable proof this can only ever match this one row.

Once reopened, the (now #5697-fixed) `banger-live-sync` cron manages it normally going forward —
no special-casing needed; entry=peak=0.55, current mark≈0.55 → `HOLD`, same as any other flat
position.

RED→GREEN verified (loosened the WHERE guard, confirmed the test fails, restored it, confirmed
green — 7/7). `tsc --noEmit` clean. No other test files touch this migration directory (no existing
precedent of a sibling `.test.ts` for a `src/lib/migrations/*.sql` file — this is the first; the
approach mirrors `findings-hygiene.test.ts`'s own string/structural-check style for a non-executable
artifact).
