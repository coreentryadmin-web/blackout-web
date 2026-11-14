## Swing `expiry_risk` force-exit gate never runs once the underlying-spot read starts 403ing — three committed positions are past their contract's expiration, still `COMMIT`, marks frozen 8 days — ESCALATED, not fixed

> **kind:** FINDING

| | |
|---|---|
| **Status** | ESCALATED — not fixed (live-trading-path, needs a design decision before shipping) |
| **Surface** | Night Hawk Swings — exit management (`swing-active-refresh` cron → `manage-sync.ts` → `manage.ts`) |
| **Severity** | P1 — real committed positions silently stuck past expiry with no force-exit, no flag, no member-visible signal beyond a stale `markAsOf` |

### Live repro (2026-11-14, confirmed against prod + the real Polygon/Massive key)

`GET /api/market/nighthawk/horizons?view=swings` currently shows three SWING `COMMIT` positions whose
option contract's own `expiry` date has already passed:

| ticker | positionId | direction | status | dte | expiry | markAsOf (frozen) |
|---|---|---|---|---|---|---|
| PLTR | 74 | SHORT | COMMIT | **-1** | 2026-11-13 | 2026-11-06T16:15:38.424Z |
| GOOG | 73 | SHORT | COMMIT | **-1** | 2026-11-13 | 2026-11-06T16:15:58.484Z |
| MRVL | 70 | SHORT | COMMIT | **-1** | 2026-11-13 | 2026-11-06T16:16:18.986Z |

`dte: -1` is computed fresh (calendar math off the static `contract_expiry`, independent of any live
feed — `dteOf(row.contract_expiry, nowMs)` in `route.ts`), so this number is trustworthy: these
contracts genuinely expired yesterday. `markAsOf` is frozen at the exact moment the already-documented
real-time-entitlement loss began (2026-11-06, see `CLAUDE.md`'s dated entry) — these are the same three
positions that entry's "Concrete Swing-visible symptom" already named, confirming the freeze is still
live 8 days later. **New here**: the contracts have now actually passed expiration while the platform
still carries them as live `COMMIT` positions with a non-expiry `reason` ("live trim — … thesis").

### Root cause — broader than the documented entitlement loss, with a real downstream consequence

`CLAUDE.md`'s "Environment realities" section documents the real-time-snapshot entitlement loss as
covering `/v3/snapshot` and the gainers/losers snapshot family (`fetchOptionsUnifiedSnapshot` and
friends). Independently re-verified live today that **the SAME outage also covers `/v2/last/trade/{ticker}`**
— not previously named in that catalogue:

```
GET https://api.massive.com/v2/last/trade/PLTR?apiKey=<prod key>
→ 403 {"status":"NOT_AUTHORIZED","message":"You are not entitled to this data. Please upgrade your plan at https://massive.com/pricing"}
```

(same 403 for GOOG and MRVL — same key that still serves grouped-daily/reference 200 OK)

That endpoint is exactly what `loadUnderlyingSpot()` (`src/app/api/cron/swing-active-refresh/route.ts:102-105`)
calls via `fetchStockLastTrade`. And `loadReads`'s very first line (`route.ts:318`):

```ts
if (spot == null) return null; // no usable underlying read → skip (fail-soft, no snapshot)
```

treats a failed underlying-spot read as **load-bearing for the whole management tick** — a deliberate,
documented design (the comment at line 296-299 explains why: structural-stop needs a trustworthy spot).
When `loadReads` returns `null`, `planManageSync`/`evaluateSwingManagement` never run **at all** for that
position this tick — no snapshot, no verdict, nothing updates.

The gap: `manage.ts`'s `expiry_risk` GATE (`evaluateSwingManagement`, lines ~349-352) is evaluated
**purely from `dte`** —

```ts
if (spec && dte != null && dte <= spec.expiryRiskDte) {
  return mk("EXIT", "expiry_risk", `DTE ${dte} ≤ ${spec.expiryRiskDte} (${spec.id} theta cliff) — force manage`);
}
```

— and `dte` is computed independently of the blocked feed (`dteOf(row.contract_expiry, nowMs)`, pure
calendar math, line 320 of the same route file, right next to the spot-null bail). So the one GATE that
could have caught this — purely time-based, no live quote required — is structurally unreachable, because
the caller bails on the missing spot **before** `evaluateSwingManagement` is ever invoked. The `swing-active-refresh`
cron itself reports `status: healthy`, `runs_24h.ok: 27` (Friday RTH) — it isn't crashing; it is silently,
successfully no-op'ing on exactly the positions that most need a verdict, with no alerting signal
distinguishing "ran clean, nothing to do" from "ran clean, skipped everything."

### Why this is NOT fixed in this PR — genuinely ambiguous, live-trading-path

Per this file's own standing escalation discipline (CLAUDE.md issue-handling policy: "Ambiguous/
live-trading-path → report, hold"), I'm raising this rather than shipping a fix, because the right
answer depends on a design decision with real capital consequences:

1. **Decouple `expiry_risk` from the spot-null bail** so a position whose calendar `dte` alone crosses
   the lane's theta-cliff threshold still gets flagged/force-managed even without a fresh spot — but then:
   what does "force manage"/"EXIT" actually DO without a live option mark? `roll-plan.ts`'s own test
   suite (`roll-plan.test.ts:202-215`) already documents the pattern for a *missing mark on an expired
   row* (`dte: -27`, `mark: null` → the roll plan defers, doesn't fabricate a close) — so the mechanism
   to defer-safely may already exist; this needs tracing end-to-end before shipping, not assumed.
2. **At minimum, surface the staleness honestly** on the member-facing board (a `markAsOf`-driven badge
   already exists as raw data, but nothing today makes "this contract is actually past expiry and we have
   no current price" land as a distinct, visible state rather than a quietly-aging timestamp) — this is
   closer to a Largo-contract C2/C3 (freshness/absence) fix and lower-risk, but still touches what members
   see about a live position's status.
3. Whatever ships needs to be correct for **all three sub-lanes'** `expiryRiskDte` thresholds and for
   both LONG and SHORT, and needs a regression test proving a `dte <= 0` position is no longer silently
   invisible to every rung, evidence-only or gating.

### Blast radius notes for whoever picks this up

- `loadShadowReads` (same file, line 108-127) has the **identical** `if (spot == null) return null;`
  shape for shadow positions — same root cause, same fix surface, not independently verified live here
  (shadow positions aren't member-committed capital, lower urgency but same bug).
- The underlying entitlement loss itself is not fixable from code (same category as the already-documented
  Benzinga/snapshot losses) — only the code-side consequence (expiry_risk unreachable, no staleness signal)
  is in scope for a fix.
- Raised on the #4076 collaboration thread for Cursor awareness/second opinion before anyone builds
  against it, per the standing CLAUDE↔Cursor collaboration protocol.
