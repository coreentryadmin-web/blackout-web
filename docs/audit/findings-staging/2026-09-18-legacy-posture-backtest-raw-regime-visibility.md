> **kind:** FINDING

## Night Hawk Legacy — posture-backtest reported the gate's verdict but not the raw inputs behind it — FIXED

| **Status** | FIXED |
|---|---|

**Root cause.** PR #5217 shipped `posture-backtest.ts`/`GET /api/admin/nighthawk/posture-backtest`
to measure `bearish-posture.ts`'s `detectBookPosture()` gate against real history. First live call
(2026-09-18, `?days=30`) returned a striking result: the gate fired SHORT on **0 of 21 sessions**
in the window, while 20 of those 21 sessions published an entirely-LONG book — this during a
window SPY closed -1.31% with 17 of 22 sessions red. That result alone cannot distinguish two very
different explanations: (a) the tape genuinely never cleared the gate's deliberate >=2-of-3
bearish-signal floor this whole window (gate correctly conservative), or (b) one of the gate's
three inputs (`tide_bias`, breadth `advance_pct`, `composite_regime`) is itself silently never
populated as bearish in the pinned `publish_context` data (an upstream data-capture gap, not a
threshold-strictness question) — and the shipped report had no way to tell which.

**Evidence.** `buildPostureBacktestReport`'s `PostureBacktestSession` type carried `gate_posture`
and `gate_reasons` (empty whenever NEUTRAL, by `detectBookPosture`'s own design) but not the raw
`regimeContextFromPersistedMarket()` output it was computed from — so a NEUTRAL verdict looked
identical whether the underlying regime read was mildly bullish or deeply bearish-but-just-under-
threshold.

**Blast radius.** Single file (`posture-backtest.ts`) and its existing test file. No route change
needed beyond the response shape gaining one more field per session. `detectBookPosture()` and
`bearish-posture.ts` remain untouched.

**Fix.** Added a `regime: { tide_bias, advance_pct, composite_regime } | null` field to each
session in `buildPostureBacktestReport`'s output — exactly the object
`regimeContextFromPersistedMarket()` already derives internally, now also returned to the caller
instead of being discarded after the gate call. `null` specifically when the session has no
regime pin at all (`regime_unavailable`), so an absent read is never confused with a genuinely
neutral one.

**Rationale.** Minimal, additive, read-only — no new capture (the values were already computed
internally, just not returned), no gate logic touched. This makes the (a)-vs-(b) question the
0%-fire-rate finding raised directly answerable by reading the next `?days=30` call's per-session
`regime` values, without a second lookup or a new tool.

**Sample size / evidence.** 2 new unit tests (raw-regime-value passthrough; `regime: null` on a
regime-unavailable session, distinguished from a genuine neutral pin) added to the existing 11,
now 13/13 passing. `npx tsc --noEmit` clean. Full `npm test`: 14840/14840 passing, 0 regressions.

**Next action.** Re-call `GET /api/admin/nighthawk/posture-backtest?days=30` once deployed and
read the per-session `regime` values across the 21 sessions: if `tide_bias`/`composite_regime` are
consistently null/NEUTRAL throughout, that points at an upstream capture gap worth a fresh
investigation; if they show real bearish-looking values that still fell short of 2-of-3, that
confirms the gate's conservatism is the limiting factor, not a data problem — still not a reason
to change the threshold on this measurement alone.
