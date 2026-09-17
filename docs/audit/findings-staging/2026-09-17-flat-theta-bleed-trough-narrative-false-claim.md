## `flat_theta_bleed` exit narrative claims "never left the ±10% band" on plays that genuinely breached it — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | Night Hawk 0DTE |
| **Severity** | P2 (member-facing false claim in a live exit's own explanation — trust/correctness, not a live-trading-decision change) |
| **File** | `src/lib/zerodte/exit-engine.ts` (`decideTrimScale`, `evaluateExitState`'s ratchet-mode `flat_theta_bleed` branch), `src/lib/zerodte/exit-sync.ts` (`evaluateLedgerRowExit`) |
| **Found by** | Standing Night Hawk 0DTE 15-min forensic cadence, aggressive-mode dig on an already-open PR #4076 thread finding (CORZ single instance, below the 3-instance noise threshold) |

### Root cause

`ExitEngineInput` (exit-engine.ts) carried `peakPremium` (latched high-water mark) but no trough
field at all. The `flat_theta_bleed` condition in both exit-mode branches only checks:

```ts
input.ageMinutes >= EXIT_RULES.flat_timeout_min &&
(peakPnlPct ?? 0) < EXIT_RULES.flat_band_pct &&   // upside: peak never escaped the band
pnlPct > -EXIT_RULES.flat_band_pct                 // downside: CURRENT mark only
```

— and unconditionally wrote `"...the play never left the ±10% band..."` into the exit detail
whenever it fired. That claim is true only if the play's price path never dipped below the band
at *any* point; the condition never checks that, only the current mark at the moment the 25-min
clock fires. A play that dipped below −10% and recovered back inside the band before the timeout
got the same "never left" sentence as a play that genuinely sat flat the whole time — the two are
different trades wearing the same explanation.

`row.trough_premium` (`src/lib/db.ts` `ZeroDteSetupLogRow`) already exists and is already
DB-latched (`LEAST`) on the same schedule `peak_premium` is `GREATEST`-latched — it is the trusted
source `closedStopReason`/the governor already use for stop determination elsewhere in this same
directory (`marks-math.ts`, `governor.ts`). `exit-sync.ts`'s `evaluateLedgerRowExit` (the sole live
caller of `evaluateExitState`) simply never read it when building the engine's input.

### Evidence

Pulled the live `GET /api/admin/zerodte/tier-export?days=10` row for every `flat_theta_bleed` exit
in `GET /api/market/zerodte/record?days=10` (2026-09-08…2026-09-16) and compared each row's own
`trough_premium` against `entry_premium` — a genuine DB fact, not a reconstruction:

| Ticker | Session | entry | trough | trough_pct | Narrative claim |
|---|---|---|---|---|---|
| CORZ | 2026-09-16 | 0.22 | 0.19 | **−13.64%** | "never left the ±10% band (peak 0%, now 0%)" |
| IONQ | 2026-09-14 | 1.30 | 1.04 | **−20.00%** | "never left the ±10% band (peak +4.23%, now −7.31%)" |
| AAPL | 2026-09-11 | 4.33 | 3.88 | **−10.39%** | "never left the ±10% band (peak +3.93%, now −8.78%)" |
| RDDT | 2026-09-10 | 1.16 | 0.81 | **−30.17%** | "never left the ±10% band (peak 0%, now −8.19%)" |
| ASTS | 2026-09-08 | 1.04 | 0.71 | **−31.73%** | "never left the ±10% band (peak 0%, now −9.62%)" |

Five confirmed instances across five separate trading days in a single week — well past the
standing 3-instance noise threshold. Cross-checked against the six `flat_theta_bleed` exits in the
same window whose trough genuinely never crossed −10% (SMTC, ALAB, SLS, OKTA, QBTS, FIGR) — all
correctly narrated "never left the band", confirming this is not a wholesale-broken feature, only
the specific breach-and-recover shape.

### Blast radius

Both `flat_theta_bleed` code paths carry the identical bug (same condition, same hardcoded
sentence): `decideTrimScale` (the default `trim_scale` exit mode) and `evaluateExitState`'s own
ratchet-mode branch. Both fixed with one shared helper (`flatTimeoutDetail`) so they can't drift
apart again.

### Fix rationale

Deliberately **narrative-only** — does not touch the exit *condition* (still fires on the exact
same age/peak/current-pnl check) or the exit *action/reason* (`flat_theta_bleed`, `EXIT`). Only the
`detail` sentence changes, and only when the DB's own `trough_premium` disagrees with the blanket
claim. This was the explicit reason the original CORZ instance was held rather than shipped
(2026-09-15 journal note): "the more thorough fix would change which plays get exited (a
live-trading-decision change, not just cosmetic)" — that concern applied to a *behavior* change
(e.g. exiting earlier on a trough breach), not to correcting the text of an exit that already
fires unchanged. Once confirmed systemic (5 instances) via real DB data, the safe half of the fix
(the narrative) no longer needed to wait for the harder, behavior-changing half (whether a trough
breach should itself trigger an earlier protective exit — left as a separate, still-open question,
not addressed here).

Added `troughPremium?: number | null` to `ExitEngineInput`, widened with the current mark via
`Math.min` (mirroring the existing `peakPremium` → `Math.max` widening and the DB's own `LEAST`
latch), and wired `troughPremium: row.trough_premium` into `exit-sync.ts`'s `evaluateExitState`
call — the field was already sitting on the row, unused for this purpose. When the trough breached
the band, the sentence becomes `"...dipped to X% intraday but recovered back inside the ±10% band
(peak Y%, now Z%)..."`; otherwise the original "never left the ±10% band" sentence is unchanged
byte-for-byte. Rows/callers that omit `troughPremium` (none live, since `exit-sync.ts` is the only
caller and now always passes it) fall back to the pre-fix sentence — a deliberate missing-data-safe
default, tested explicitly.

### Tests

`src/lib/zerodte/exit-engine.test.ts` — 5 new cases: trim_scale-mode narrative unchanged when the
trough never breaches, trim_scale-mode narrative corrected when it does, trim_scale-mode fallback
with `troughPremium` omitted (old sentence, no regression), and the same unchanged/corrected pair
for ratchet mode. All verified RED (fail without the exit-engine.ts/exit-sync.ts fix, PASS with
just the test-only stash reverted) → GREEN via `git stash` isolating the source fix from the test
file. Full `npm test` + `npx tsc --noEmit` run clean.
