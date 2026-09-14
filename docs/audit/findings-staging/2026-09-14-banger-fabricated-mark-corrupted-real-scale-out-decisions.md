> **kind:** FINDING

## The zero-bid-backstop mark bug (pre-#4969) did not just display wrong P&L — it fired real, false TAKE_PARTIAL/EXIT_RUNNER decisions on at least 5 banger positions, with fabricated realized P&L now persisted in production

| **Status** | CONFIRMED, NOT YET CORRECTED — needs operator decision on remediation, not a routine auto-merge fix |
|---|---|

**Root cause.** PR #4969 (merged 2026-09-14 ~14:14 UTC) correctly fixed the *display* consequence of a zero-bid
backstop quote (bid=0, ask=high) producing a midpoint (e.g. $7.50) wildly divergent from a contract's real
last-traded price. But that same fabricated `mark` value was never purely cosmetic: `src/lib/banger/live-sync.ts`
feeds it directly into `deriveScaleOutAction()` (`src/lib/zerodte/scale-out.ts`), which is the REAL decision engine
for whether a banger position auto-transitions to `TAKE_PARTIAL` (mark ≥ 2× entry) / `EXIT_RUNNER` (mark retraces to
50% of peak) / `STOP_OUT`. Worse, `peak_premium` is written via `GREATEST(COALESCE(peak_premium,$3),$3)`
(`src/lib/banger/positions-db.ts`) — a **monotonic ratchet that can only increase, never decrease**. A single bad
tick with a fabricated mark permanently writes a fabricated `peak_premium` into the database. #4969's fix stops
*future* ticks from computing a bad mark; it does **not** retroactively correct any `peak_premium`/`status`/
`realized_pnl_pct`/`realized_pnl_usd` already written from a pre-fix bad tick.

**Evidence (live production data, verified 2026-09-14 ~14:39 UTC, `GET /api/market/banger/board` cross-checked
against direct Polygon queries — both current live quotes and full real daily trade history per contract).**

| ticker | contract | entry | recorded `peak_premium` | real max trade price (ever) | divergence | current `status` | `scaled_already` | `scale_out_action` | `realized_pnl_pct` |
|---|---|---|---|---|---|---|---|---|---|
| CPRI | O:CPRI260918C00015000 | $0.10 | **$7.50** | $0.10 (never exceeded entry) | **75×** | CLOSED_RUNNER | true | EXIT_RUNNER | 50% |
| CRSR | O:CRSR260918C00015000 | $0.07 | **$7.50** | $0.12 | **62.5×** | CLOSED_RUNNER | true | EXIT_RUNNER | 35.71% |
| BW | O:BW260918C00008500 | $0.15 | **$7.50** | $0.20 | **37.5×** | CLOSED_RUNNER | true | EXIT_RUNNER | 8.33% |
| EBS (id 990) | O:EBS260918C00007000 | $0.10 | **$7.50** | $0.35 | **21.4×** | CLOSED_RUNNER | true | EXIT_RUNNER | 37.5% |
| EBS (id 931) | O:EBS260918C00006000 | $0.15 | **$7.50** | $0.55 | **13.6×** | CLOSED_RUNNER | true | EXIT_RUNNER | 83.33% |
| BAND (control) | O:BAND260918C00060000 | $0.93 | $1.20 (real) | $1.85 | none (under, not over) | OPEN | false | HOLD | — |

All five suspect rows carry the **identical** `peak_premium: 7.5` across five unrelated tickers/strikes/entry
dates — real market peaks do not coincidentally converge on one number; this is the fabricated backstop midpoint
written into every affected row. For **CRSR, BW, and CPRI specifically, real trading never once crossed the 2×
entry `TAKE_PARTIAL` threshold at any point in the contract's full trading history** — there is no legitimate
market event under which `scaled_already` could have flipped to `true` for these three. (EBS's two contracts did
independently cross 2× via real trading at some point, so their `TAKE_PARTIAL` trigger may be coincidentally
legitimate — but their `EXIT_RUNNER` close and realized P&L are still computed against the fabricated $7.50 peak's
50%-retrace level, not a real one, so those numbers are corrupted regardless.)

**Consequences, concretely:**
1. **False member-facing Discord notifications already fired** — `notifyBangerFromScaleOutAction` is called on every status transition (`live-sync.ts`); a `TAKE_PARTIAL`/`EXIT_RUNNER` transition on CRSR/BW/CPRI means members were told these positions scaled out and closed profitably, when the real market never gave any such move.
2. **Corrupted realized P&L already persisted** — `realized_pnl_pct`/`realized_pnl_usd` (e.g. CPRI +50%/+$5, EBS(931) +83.33%/+$12.5) do not reflect what following this system's own real market data would have produced. These numbers will corrupt any win-rate/track-record statistic computed from `banger_positions` until corrected.
3. **Positions were closed (`status: CLOSED_RUNNER`) based on a fabricated retrace-from-peak trigger** — even where the underlying was still open/live, the system's own book now shows it closed.
4. **Full blast radius is NOT yet known.** `GET /api/market/banger/board` hardcodes `limit=60` (no override param) and orders by `session_date DESC, id DESC` — **PAGS and ACVA (also named in #4969's original evidence) have already aged out of this window and could not be retrieved from this sandbox.** Raw Postgres is blocked here (per CLAUDE.md environment notes), so a complete sweep of every `banger_positions` row touched by this bug needs either direct DB access or a purpose-built admin export route — neither available from this sandbox. The 5 confirmed rows above are a **lower bound**, not the full count.

**Blast radius (code):** `src/lib/banger/live-sync.ts` (`fetchMarks`/`deriveScaleOutAction` call site — already
fixed going forward by #4969), `src/lib/banger/positions-db.ts` (`peak_premium` ratchet — unchanged, still
monotonic, still vulnerable to a future different-shaped bad-mark bug), `src/lib/banger/discord-trade-notify.ts`
(already-fired notifications, no code defect of its own — it correctly reported what the corrupted upstream state
told it to).

**Why this is not being auto-fixed here:** correcting `peak_premium`/`status`/`scaled_already`/`realized_pnl_pct`/
`realized_pnl_usd` on rows that already represent "closed" positions with member-facing notifications already sent
is a data-correction on production financial/track-record data with real member-communication implications (does a
correction need a retraction notice? does the track record need a footnote?) — a product/business decision, not a
small/unambiguous CARVE-OUT fix. Raised for a decision rather than unilaterally rewriting closed-position history.

**Recommended next steps (for operator/Cursor discussion, not yet actioned):**
1. Establish the true full blast radius — needs DB-level access this sandbox doesn't have (AWS creds + a real
   query, or a new admin export route).
2. Decide remediation for the confirmed 5+ rows: recompute `realized_pnl_pct`/`realized_pnl_usd` against the real
   last-trade price at time of the (now known-fabricated) EXIT_RUNNER tick, or flag/null them with an honest
   "corrected — see incident note" marker, rather than silently rewriting history.
3. Consider a defense-in-depth guard on `peak_premium`'s ratchet write itself (e.g. reject a peak update that isn't
   corroborated by `last_trade`/`session.close`, the same guard #4969 added for the *display* mark) so a future,
   differently-shaped bad-quote bug can't repeat this — a `peak_premium`-specific hardening, not just the mark
   read #4969 already fixed.
4. Confirm whether any member-facing correction/notice is warranted for the false TAKE_PARTIAL/EXIT_RUNNER
   Discord notifications already sent.
