# 0DTE live-marks lane tracks a zombie row whose OCC already expired — permanent stage-D RED

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (correctness + wasted poll load; not user-money-affecting — the row already carries no live mark/P&L) |
| **Area** | 0DTE Night Hawk — live marks lane (`src/lib/zerodte/live-marks.ts`) |
| **Found by** | Standing 5-engine live monitor, RTH-open cycle 2026-09-11 |

## Root cause

`toActivePlay()` (the function that decides whether a `zerodte_setup_log` row is a
currently-trackable 0DTE position) only excluded rows with `status === "CLOSED"` or no
plan OCC at all. It never checked whether the row's OCC had actually already expired.

Live evidence, `GET /api/market/zerodte/marks` on 2026-09-11 (today, RTH open):

```json
{
  "ticker": "OKTA",
  "occ": "O:OKTA260904C00140000",
  "status": "TRIM",
  "entry_premium": 5.97,
  "mark": null,
  "source": "none",
  "stale": true
}
```

`O:OKTA260904C00140000` expires **2026-09-04** — a full week before this row was read
out of **today's** (`2026-09-11`) `zerodte_setup_log` (the `fetchZeroDteSetupLog(todayEt())`
query in `db.ts` filters strictly on `session_date = $1::date`, so this row's own
`session_date` genuinely is today, while its tracked contract is a week dead).

0DTE's entire premise is same-day expiry — a contract can never legitimately still be
"active" days after its own OCC's expiry. Whatever end-of-day sweep is supposed to close
out same-day plays missed this one (root cause of *that* miss is a separate, DB-side
question this sandbox can't reach — raw Postgres is blocked here, see CLAUDE.md's
"Environment realities"), and once missed, nothing downstream ever re-checked: the live-
marks poller kept including it in `getActivePlays()`'s tracked set every tick forever,
trying (and failing) to fetch a quote for a symbol that has no market anymore.

**Reproduced twice, 10 minutes apart, via `npm run healthcheck:0dte`** — same OCC, same
`mark:null/source:"none"/stale:true`, both times: this is a stable stuck row, not
transient network noise (a transient miss wouldn't reproduce the identical dead OCC on
consecutive runs).

## Blast radius

- **`zerodte-e2e-healthcheck.mjs` stage D (LIVE MARKS+P&L) is pinned RED indefinitely**
  until this row ages out on its own (it won't — nothing was ever going to close it).
  Confirmed: two consecutive live runs both failed stage D on this exact row.
- **Wasted poll work.** `runZeroDteMarkTick` (the ~1s poller) re-includes this OCC in its
  tracked/subscribe set on every tick, subscribing a WS symbol and/or spending a REST
  snapshot slot for a contract that can never return a quote — forever, until the process
  restarts or the row is manually closed.
- **The `condor_legs[0].occ` path had the identical gap** — a condor whose anchor leg's
  OCC disagrees with the row's `session_date` was equally untracked-but-still-tracked.
  Fixed at the same call site since both paths now resolve `occ` before checking expiry.

## Fix

`toActivePlay()` now parses the OCC's embedded expiry (`O:TICKER YYMMDD C/P STRIKE`) and
excludes the row (returns `null`, same shape as the existing `CLOSED` guard) when that
expiry disagrees with the row's own `session_date` — the sharp, data-only invariant that
"0DTE" already promises, requiring no `now`/clock threading through the function. A row
whose OCC fails to parse at all is left alone (format problem, not an expiry one — the
existing null-mark path already surfaces that honestly).

## Alternative considered

Comparing OCC expiry against `Date.now()`/`todayEt()` instead of the row's own
`session_date` was considered and rejected: it would require threading a `now` parameter
through `toActivePlay`/`boundActivePlays`/every call site and every test fixture, for a
strictly weaker check — a row is invalid the instant its own OCC and session_date
disagree, regardless of what day the poller currently thinks it is.

## Evidence (before/after)

- RED before fix: `npx tsx --experimental-test-module-mocks --test src/lib/zerodte/live-marks.test.ts`
  → 33 pass / 1 fail (git-stashed the fix, kept only the new test).
- GREEN after fix: same command, 34 pass / 0 fail.
- `npx tsc --noEmit`: clean.
- Full `src/lib/zerodte/*.test.ts`: 1400 pass / 0 fail / 1 skipped (pre-existing skip,
  unrelated).

## Market-open validation

Logged in `docs/audit/MARKET-OPEN-VALIDATION.md` — re-run `npm run healthcheck:0dte`
during the next RTH session and confirm the OKTA row no longer appears in
`GET /api/market/zerodte/marks`'s `entered` set, and that stage D is no longer pinned
RED by a dead-OCC row (a fresh, live RED for a *different*, genuinely-live contract is
still possible and would be a separate finding).
