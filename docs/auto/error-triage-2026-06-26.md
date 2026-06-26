# error-triage — 2026-06-26 (daily slot, ~04:42 UTC)

Autonomous daily production error triage (SDLC §3). Checks the durable error sink, incidents, admin
health, the 24h provider-telemetry dashboard, and **cron-health** on the LIVE app
(`blackouttrades.com`, logged-in admin session via the Chrome bridge) for NEW/spiking error
signatures since the prior run (**OVERNIGHT-4, ~03:50 UTC @ base `40fcc24`**), root-causes each, then
applies the FIX-vs-FLAG policy.

Repo: `C:/Users/raidu/blackout-cron` (isolated cron clone). `git pull` clean → base `e39666d`,
**tsc-green (exit 0)**. Market CLOSED (~9:42 PM PT, Thu). Prior triage runs today (2026-06-25):
`error-triage-2026-06-25.md` (12:45) · `-pm` · `-night` · `-late` · `-evening` · `-overnight` ·
`-overnight2` · `-overnight3` · `-overnight4` (sector-tide fix `40fcc24`, live-verified).

---

### A. NEW signature found + FIXED (observability) → main (`cc35f9e`)

**Signature:** `cron-health` summary `failed: 1` — **Night Hawk Edition** worker (`nighthawk-playbook`,
"5:30 PM ET weekdays", _"Full dossier pipeline → Claude plays → publish"_) `last_status: "failed"`.

| field | value |
|---|---|
| last_run_at | 2026-06-25 **23:32:14 UTC** |
| last_duration_ms | 91540 (~91s — full synthesis ran) |
| last_message | **"Claude returned no parseable plays."** |
| meta.candidates | **40** (dossier pipeline found candidates) |
| meta.plays_count | **0** |
| meta.edition_for | 2026-06-26 |

This did NOT hit the durable sink, raise an incident, or show in the API dashboard (it's a handled
terminal-fail inside the worker, not an HTTP 4xx/5xx) — **only `cron-health` exposed it.** It is the
same class the e2e-interaction-sweep flagged earlier today (`docs/auto/e2e-2026-06-25.md` §Task #1),
which was **blocked "pending failed-run logs to disambiguate"** — those logs never surfaced.

**Root cause (locus):** `claude-edition.ts` `generateEditionPlays` zeroes the play count through 4
chained filters — `parsePlaysJson` → `play_type==="stock"` only (drops index/etf) →
`filterPlaysWithinPremiumCap` → `validatePlayAgainstChain` (strike/OI). Any single stage can zero it,
but the failure message (`edition-builder.ts:318-322`) was the **generic, misleading** "no parseable
plays" — so the actual cause (legit-empty night vs over-strict filters vs Claude format drift) was
**undiagnosable without Railway logs**. The `console.warn`s only fired for the premium- and
strike-reject stages, and `synthRaw` (Claude's actual response) was discarded on the failure path.

**What I fixed vs. what I flagged:**
- The **observability gap** is high-confidence, isolated, and NOT product-deciding → **FIXED → main**.
- The **"0 plays after filtering" decision** (loosen filters? legit empty? format drift?) is
  LLM/market-data/product-deciding → **FLAGGED** (Task #1), not auto-fixed. Correct per FIX-vs-FLAG.

**Fix (`cc35f9e`, 2 files, observability-only — zero change to play selection):**
- `claude-edition.ts` — `generateEditionPlays` now returns a `funnel: {parsed, stock, premium_ok,
  strike_ok}` (additive, optional field).
- `edition-builder.ts` — the 0-plays failure path now writes a self-diagnosing error: `parsed===0`
  → _"Claude returned no parseable JSON plays (raw N chars)"_; else _"All plays filtered out —
  funnel: P parsed → S stock → C within-cap → K strike-valid."_ This lands in `cron-health
  meta.error`, so the next failure names its own killing stage with no Railway dig.
- Only other caller `hunt-builder.ts:242` destructures just `{plays}` — unaffected.
- `npx tsc --noEmit` exit 0 · `npm run build` exit 0 → high-confidence small isolated → `main`
  (clean ff from `e39666d`).

**Secondary observation (flagged, not a hard bug):** the `nighthawk_job` for "Fri Jun 26" is stuck
`status:"running"` at `stage_synthesis` (updated 00:45:43 UTC, ~4h stale) — a process killed
mid-synthesis (Railway restart/OOM) before the top-level failed-catch (`edition-builder.ts:453`) ran.
**Not a hard block:** the next fire falls through to resume-from-checkpoint (`running` matches neither
the `!job` nor `failed` branch at `:126-133`, so it proceeds and re-runs synthesis). But the
2026-06-26 edition will not auto-recover before Friday's 5:30 PM ET fire. A stale-`running` reaper /
advisory lock is the larger #70 concurrency work (`NIGHT_HAWK_AUDIT_2026-06-25.md`) → flag-only.

---

### B. Rest of the live surface — CLEAN

| Source | Endpoint | Result |
|---|---|---|
| Durable error sink | `/api/admin/errors?limit=200` | ✅ `events:[]` — 0 |
| Open incidents | `/api/admin/incidents` | ✅ `incidents:[]` — 0 |
| Admin health | `/api/admin/health` | ✅ `health_ok:true`; critical/warning/info/api_errors all 0; `issues:[]`; `route_errors:[]`; `redis_degraded:false`; `market_health_ok:true` |
| Provider health (5m) | `/api/admin/health` | ✅ polygon `113 calls / 0 err` (200), UW `33 calls / 0 err` (200, `/net-flow/expiry`), anthropic idle; all WS OPEN+auth (polygon-indices, UW 5 channels, Massive options 1 shard); rate-limiters healthy (uw circuit closed `recent429s:0`, polygon `consecutive429:0`) |
| API dashboard (24h) | `/api/admin/apis/dashboard` | ✅ `recent_errors:[]`, `active_retries:[]`, `summary.error_rate:0`; **120/120 recent_events status 200**; 0 endpoints with telemetry error_count>0; `db_pool` 3/3 idle |
| Cron health | `/api/admin/cron-health` | ⚠️ `failed:1` (Night Hawk Edition, §A); the other 12 jobs healthy/skipped/unknown — no other failure |

Sector-tide is now clean (no `Invalid sector` 400 in telemetry) — confirms the OVERNIGHT-4 fix
(`40fcc24`) is holding live. SPX/VIX WS prices at 0 = expected off-hours (market closed). The
`SPX Engine`/`Night's Watch Warm` `skipped` statuses are the benign off-hours suppression
(don't tick while market closed) — no incident, `health_ok:true`. No action (anti-theater).

---

### Result

**✅ ONE new signature found (cron-health `failed:1`) → observability FIXED → main (`cc35f9e`) +
root cause FLAGGED (Task #1).** The Night Hawk Edition synthesis failure ("0 plays after filtering")
is now self-diagnosing: the next failure reports its exact killing funnel stage in `cron-health
meta.error` — which directly unblocks the e2e §Task #1 that was stalled "pending failed-run logs."
The actual filter-vs-product decision stays flagged (not autonomously decidable). All other surfaces
(durable sink, incidents, health, route_errors, 24h telemetry) clean; sector-tide fix holding.

### Carry-forward (toward 0-open-issues — human merge-or-close)
- **Task #1 (this run):** after `cc35f9e` deploys, operator runs `nighthawk-playbook` "Run now"
  (force) to recover Fri's edition + capture the funnel breakdown, then pick the fix (loosen filters /
  accept empty / fix parse) from the now-visible killing stage.
- Stale-`running` job reaper / advisory lock for Night Hawk Edition = #70 concurrency work (flag).
- Open auto branches awaiting review: `auto/error-triage-2026-06-25-anthropic-timeout`,
  `auto/error-triage-2026-06-25`, `auto/anthropic-caching-2026-06-25`, `auto/clerk-webhook-2026-06-25`,
  `auto/far-dated-gex-2026-06-25`.
- `play_engine.critical_stale` off-hours cosmetic (gate behind RTH check) — low-value flag.

---

## RUN 2 — 2026-06-26 ~05:41 UTC (daily slot)

Second daily pass, ~1h after RUN 1 (04:42 UTC @ `cc35f9e`). Repo `C:/Users/raidu/blackout-cron`,
`git pull` clean → base **`c476793`**, **tsc-green (exit 0)**. Market CLOSED (~10:41 PM PT, Thu).
Re-checked all live error surfaces on `blackouttrades.com` (logged-in admin, Chrome bridge) for NEW or
spiking signatures since RUN 1.

### A. Full live surface — CLEAN (no new/spiking signatures)

| Source | Endpoint | Result |
|---|---|---|
| Durable error sink | `/api/admin/errors?limit=200` | ✅ `events:[]` — 0 |
| Open incidents | `/api/admin/incidents` | ✅ `incidents:[]` — 0 |
| Admin health | `/api/admin/health` | ✅ `health_ok:true`; critical/warning/info/api_errors all 0; `issues:[]`; `route_errors:[]`; `redis_degraded:false`; `market_health_ok:true` |
| Provider health (5m) | `/api/admin/health` | ✅ polygon `126 calls / 0 err` (200), UW `43 calls / 0 err` (200, `/net-flow/expiry`), anthropic idle; all WS OPEN+auth (polygon-indices 7 syms, UW 5 channels, Massive options 1 shard); rate-limiters healthy (uw circuit closed `recent429s:0`, polygon `consecutive429:0`) |
| API dashboard | `/api/admin/apis/dashboard` | ✅ `summary.error_rate:0`, `recent_errors:[]`, `active_retries:[]`; **120/120 recent_events status 200**; 0 endpoints with `error_count>0` |
| Cron health | `/api/admin/cron-health` | ⚠️ `failed:1` — **same** Night Hawk Edition signature as RUN 1 (§ below); other 12 jobs healthy/skipped/unknown |
| Live route probe | `/`, `/api/health`, `/api/market/gex-positioning?ticker=SPX`, `/api/admin/cron-health` | ✅ all **200** (no 5xx) |

### B. The one failure is UNCHANGED + already handled (no action — anti-theater)

`cron-health` still reports the single `failed:1`: **Night Hawk Edition** (`nighthawk-playbook`),
`last_run_at` **2026-06-25 23:32:14 UTC**, `last_message: "Claude returned no parseable plays."`,
`meta.candidates:40 / plays_count:0`, `edition_for:2026-06-26`. This is **byte-identical** to RUN 1 —
the worker has **not re-fired** (next fire is **Fri 5:30 PM ET**), so this is NOT new and NOT spiking;
it is the same signature RUN 1 already (a) fixed for observability → `cc35f9e` and (b) flagged for the
product decision → **Task #1**. The stale-`running` `nighthawk_job` ("Fri Jun 26", `stage_synthesis`,
`updated_at 2026-06-26T00:45:43Z`) is likewise unchanged — already flagged as #70 concurrency work.

**Verified the RUN 1 fix is actually live:** `git merge-base --is-ancestor cc35f9e origin/main` → **YES**
(Railway deploys from `origin/main`). So Task #1's self-diagnosing funnel error IS armed for Friday's
fire — the next failure will name its own killing stage in `cron-health meta.error`. Re-running
"Run now" to force-recover the edition is a product/LLM decision and remains the **operator's** action
(Task #1), not autonomously decidable → correctly left flagged, not auto-triggered.

### Result

**✅ ZERO new or spiking signatures since RUN 1.** Durable sink / incidents / health / `route_errors` /
24h telemetry / live route probe all clean; the lone `failed:1` is the pre-existing Night Hawk Edition
case (fix `cc35f9e` confirmed on `origin/main`, root cause flagged Task #1, hasn't re-fired). Nothing
new to fix or flag — manufacturing a change here would violate the no-theater guardrail. Carry-forward
items from RUN 1 stand unchanged (Task #1 operator-run; #70 reaper; open `auto/*` branches awaiting
review).

---

## RUN 3 — 2026-06-26 ~13:54 UTC (daily slot)

Third pass today (RUN 1 04:42 @ `cc35f9e`, RUN 2 05:41 @ `c476793`). Repo `C:/Users/raidu/blackout-cron`,
`git pull` clean → base **`34a8736`**, **tsc-green (exit 0)**. Market CLOSED (~6:54 AM PT, Fri).
Re-checked all live error surfaces on `blackouttrades.com` (logged-in admin, Chrome bridge). **Unlike
RUNS 1–2 (sink empty), the durable sink now holds a NEW, spiking signature.**

### A. NEW spiking signature found + FIXED → main (`cc17d83`)

**Signature:** `admin/nighthawk/publish-preview :: invalid input syntax for type date: "Mon Jun 29"`
— **69 occurrences**, all today **07:09:50 → 07:57:50 UTC** (~1.4/min, id 1–69), `source: admin_route`.
This is the **ONLY** distinct signature in the sink (69/69). It was absent in RUN 1 & RUN 2 (both
`events:[]`), so it is unambiguously **new + spiking** within the window.

| field | value |
|---|---|
| route | `GET /api/admin/nighthawk/publish-preview` |
| message | `invalid input syntax for type date: "Mon Jun 29"` |
| origin | `pg-pool/index.js:45` → `fetchNighthawkEditionByDate` → `WHERE edition_for = $1::date` |
| HTTP result | 502 (route.ts:24 catch) + recorded admin-route error, ×69 |

**Root cause — the INBOUND twin of #77 Bug 1.** #77 Bug 1 fixed the DB *read* path (`isoDateString`,
db.ts:965) so the client stops *receiving* the year-stripped `String(Date).slice(0,10)` label
`"Mon Jun 29"`. But the *query* path stayed unguarded: `route.ts:12` took the raw `edition_for` query
param and `publish-preview.ts:50` → `fetchNighthawkEditionByDate` fed it straight into `$1::date`. A
caller is still sending the legacy `"Mon Jun 29"` label, so Postgres threw `invalid input syntax for
type date` → caught → 502 + sink record, 69× in 48 min. The admin dashboard calls publish-preview
WITHOUT `edition_for` (AdminNightHawkDashboard.tsx:232), so the bad param is external/manual/scripted
(likely Task-#1 "Run now" recovery tooling or a poller holding a pre-#77 label).

**Fix (`cc17d83`, 2 files — high-confidence, isolated, build-gated → main):**
- **db.ts** — new exported `normalizeIsoDateInput(raw)`: accepts an already-ISO value (round-trip
  validated through `Date`, so structurally-ISO-but-invalid inputs like `2026-13-45` / `2026-02-30`
  are also rejected, not just `"Mon Jun 29"`); recovers a stringified Date that still carries a 4-digit
  year (`"Mon Jun 29 2026"` → `2026-06-29`); rejects yearless/garbage. The inverse of `isoDateString`.
  Unit-tested 11/11 edge cases before commit.
- **db.ts** — `fetchNighthawkEditionByDate` now normalizes its arg and **returns null** for non-ISO
  input instead of crashing the `$1::date` cast — protects ANY caller, including the **public**
  `/api/market/nighthawk/edition` route (`route.ts:97`, `?date=` param), which had the **same latent
  crash** (a 500 there, no try/catch) and now degrades gracefully to latest/empty.
- **publish-preview route** — validates `edition_for` at the boundary via the shared helper and returns
  a clean **400** (not a recorded 5xx) for bad input. No more sink spam for client-supplied garbage.
- `npx tsc --noEmit` exit 0 · `npm run build` exit 0 → pushed `main` (`34a8736..cc17d83`,
  confirmed `git merge-base --is-ancestor cc17d83 origin/main` → YES; Railway deploys from origin/main).

**FIX vs FLAG:** the server hardening is the high-confidence, isolated, build-gated half → FIXED → main.
The *source* of the malformed `"Mon Jun 29"` param (now defanged to 400s, no longer a production error)
is an external/scripted caller I can't fix with confidence from here → **FLAGGED (Task #1)**: trace via
Railway access logs; if it's an in-repo surface, make it send ISO or omit the param.

### B. Rest of the live surface — clean / known-benign (no other action — anti-theater)

| Source | Endpoint | Result |
|---|---|---|
| Durable error sink | `/api/admin/errors` | ⚠️ 69 events — single signature §A (NEW, fixed). No other signature. |
| Open incidents | `/api/admin/incidents` | ✅ `incidents:[]` — 0 |
| Admin health | `/api/admin/health` | ⚠️ `health_ok:false` — but the only `issues` are 3 websocket warnings (`I:TICK`/`I:TRIN`/`I:ADD` "stale or zero", `price=0`): **market-internals breadth tickers off-hours = EXPECTED** (market closed, Fri 6:54 AM PT). `route_errors:[]`, `redis_degraded:false`, critical/api_errors 0. Benign off-hours, not a production error. |
| API dashboard (24h) | `/api/admin/apis/dashboard` | ⚠️ `error_rate:0.625`, 5 `recent_errors` — these are the **same** publish-preview spike (§A) bleeding into the 24h telemetry window; not a separate signature. Will clear as `cc17d83` deploys + the window rolls. |
| Cron health | `/api/admin/cron-health` | ⚠️ `failed:1` — the **same** Night Hawk Edition case (RUN 1 §A, fix `cc35f9e` live, flagged Task-#1-prior). Unchanged, not new, not spiking. 9 healthy / 1 warning / 2 unknown otherwise. |
| Live route probe | `/`, `/api/admin/cron-health` | ✅ 200 |

The `health_ok:false` is driven solely by off-hours TICK/TRIN/ADD staleness — gating those breadth
warnings behind an RTH check is the low-value cosmetic flag already carried from RUN 1
(`play_engine.critical_stale` class). No change here (anti-theater).

### Result

**✅ ONE new spiking signature (publish-preview `::date` crash, 69×) → root-caused + FIXED → main
(`cc17d83`), source FLAGGED (Task #1).** Server now rejects malformed `edition_for` with a 400 (admin)
and degrades gracefully (public edition route), eliminating both the 69× sink spam and a latent public
500 of the same class. All other surfaces are either the known Night Hawk Edition `failed:1`
(carry-forward) or benign off-hours WS staleness. The 24h dashboard `error_rate:0.625` is the same
spike and self-clears post-deploy.

### Carry-forward (toward 0-open-issues)
- **Task #1 (this run):** trace the external caller sending `edition_for="Mon Jun 29"` (Railway access
  logs / referrer); fix it to send ISO or omit the param if it's an in-repo surface.
- Prior carry-forwards stand: Night Hawk Edition synthesis funnel (operator "Run now" — prior Task #1);
  stale-`running` job reaper / advisory lock (#70); off-hours WS-staleness RTH gate (cosmetic);
  open `auto/*` branches awaiting human review.
