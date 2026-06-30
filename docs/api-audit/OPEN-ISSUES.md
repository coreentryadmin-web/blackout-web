# BlackOut Open Issues Log
Last updated: 2026-06-30 13:40 ET

> **30 Jun 2026 — RTH pass 2 GREEN** after OTM strike chain-band fix (PR #117) + unlisted-position reconcile (PR #118).
> Canonical audit probe list: `docs/api-audit/AUDIT-SKILL-REFERENCE.md` (in-repo SKILL:
> `.cursor/skills/platform-audit/SKILL.md`).

## RTH comprehensive sweep — 2026-06-30 ~13:04–13:40 ET (pass 2)

**Session:** Tue 30 Jun 2026, 13:04–13:40 ET (RTH open). Agent: autonomous RTH cloud session.

### Validation summary

| Check | Result |
|---|---|
| `npm run validate:rth-open` | ✅ GREEN (post PR #118 deploy) |
| `GET /api/cron/data-correctness?force=1` | ✅ 0 flags (post PR #117 deploy) |
| `npm run ops:collect` | ✅ 0 action items |
| `node scripts/full-site-deep-audit.mjs` | ✅ 48 pass / 0 P0 (post warm) |

### Fixes shipped

| ID | Issue | Fix | PR |
|---|---|---|---|
| **P0 QUBT chain-confirm false flag** | Deep OTM leg QUBT 22C outside spot-centered chain band; per-OCC snapshot priced it but verifier only checked narrow chain | Strike hints widen `fetchNwOptionChain` band; verifier checks snapshot first | **#117** |
| **P1 rth-open nw15 typo** | `nw15 is not defined` ReferenceError after socket-health refactor | Restore `nights-watch-warm` Postgres freshness check | **#118** |
| **P1 socket-health probe** | Multi-replica log grep missed options-socket auth | HTTP `/api/cron/socket-health` probe | **#116** |
| **P0 unlisted NW positions** | User-saved strikes outside chain band caused persistent correctness flags | Auto-close unlisted positions via `unlisted-reconcile` | **#118** |

### API sweep (CRON bearer — 13:38 ET)

| Endpoint | HTTP | Notes |
|---|---|---|
| `/api/market/spx/desk` | 200 | VIX ~16.68, `as_of` fresh |
| `/api/market/spx/merged` | 200 | SPX ~7498, finite |
| `/api/market/flows` | 200 | 200 rows, Σ premium finite |
| `/api/market/gex-positioning` | 200 | walls/flip finite |
| `/api/market/gex-heatmap` | 200 | 10×4 matrix invariants pass |
| `/api/market/nighthawk/edition` | 200 | 3 plays 2026-06-30 |
| `/api/grid/*` (8 panels) | 200 | all finite |
| `/api/public/track-record` | 200 | 6 closed SPX (0W/6L); page sync OK |

**Cross-tool agreement:** desk SPX vs Polygon oracle Δ 0.00; GEX positioning ↔ heatmap ↔ desk aligned.

### Browser sweep (premium Clerk ticket — 13:25 ET)

| Page | Soft-nav | Live tick | Console | Missing fields |
|---|---|---|---|---|
| `/dashboard` | <1s | ✅ ~8s (SPX/VIX/tickers) | manifest #418, wait-feed warn | none |
| `/flows` | <1s | ✅ SSE tape | 2 issues | none |
| `/heatmap` Matrix | <1s | ✅ LIVE chip | 1 issue | brief OFFLINE on load |
| `/heatmap` Profile | instant | ✅ | same | none |
| `/grid` | <1s | n/a (panels collapsed) | 1 issue | content behind collapsed panels (30/32) |
| `/nighthawk` | <1s | static playbook | clean | none |
| `/terminal` (Largo) | <1s | AI ~10–15s | 1 issue | none |
| `/track-record` | <1s | LIVE chip | clean | none |

**Largo QA:** NVDA dark pool + flow question → grounded ($6.42M in 78s, specific strikes/fills, spot $198.39). Follow-up on $200 call stack → dealer structure (walls, gamma flip, net GEX +$656.7M). Sources cited: LIVE DESK FEED, DARK POOL, OPTIONS FLOW.

### Missing-field audit (API-backed)

| Field / surface | Backing API | Cause | Action |
|---|---|---|---|
| `nope`, `dark_pool.pcr` on desk/flows | UW optional channel | **Upstream gap** | Expected — show unavailable |
| `gex-heatmap` overlays | overlay warm | **Expected off** | Note only |
| Grid panel bodies | collapsed UI state | **UX** — expand to view | Not a data gap |
| Heatmap matrix initial OFFLINE | cold SWR tail | **Transient** — recovers <1s | Watch only |

### Ops watch

| ID | Item | Status |
|---|---|---|
| **OPS-6** | Cron cadence gaps (flow-ingest, grid-warm) | Watch — `?force=1` + self-heal clears |
| **OPS-7** | Sentry `TypeError: fetch failed` (06:38 UTC) | Watch — 0 error_events last 1h |
| **OPS-9** | Dashboard console manifest #418 | P2 cosmetic — non-blocking |

## RTH comprehensive sweep — 2026-06-30 ~12:02–12:20 ET (pass 1)

**Session:** Tue 30 Jun 2026, 12:02–12:20 ET (RTH open). Agent: autonomous RTH cloud session.

### Validation summary

| Check | Result |
|---|---|
| `npm run validate:rth-open` (pre-fix) | ❌ options-socket log auth false-fail; grid-warm RTH-stale |
| `npm run validate:rth-open` (post-fix) | ✅ GREEN |
| `GET /api/cron/data-correctness?force=1` | ✅ 0 flags, 7 oracle-confirmed |
| `npm run ops:collect` | ✅ 0 action items (post warm) |
| `node scripts/full-site-deep-audit.mjs` | ✅ 48 pass / 0 issues (post warm) |
| `node scripts/gha-rth-audit.mjs` | ⚠️ transient P0 spot>HOD race at 12:16; flow-ingest stale flag cleared after warm |

### Fixes shipped (branch `fix/rth-grid-warm-self-heal-socket-check`)

| ID | Issue | Fix |
|---|---|---|
| **P0 grid-warm self-heal gap** | Watchdog flagged `grid-warm` RTH-stale; self-heal skipped it (not in `CRON_DISPATCH`) | Added `grid-warm` to `cron-dispatch.ts` + `Grid-Warm-Cron` service name map |
| **P1 RTH socket false-fail** | `validate:rth-open` required options-socket auth log line — unreliable on 5-replica cluster | Postgres-backed check: `nights-watch-warm` ok + open-position count; idle when 0 positions |

### API sweep (CRON bearer — premium endpoints)

| Endpoint | HTTP | Latency | `as_of` fresh | Notes |
|---|---|---|---|---|
| `/api/market/spx/desk` | 200 | ~1.3s | ✅ | SPX ~7493, VIX ~16.7; oracle Δ 0.02 |
| `/api/market/spx/pulse` | 200 | ~2.8s | — | `price_age_ms` null (optional) |
| `/api/market/flows` | 200 | ~8.7s | — | 200 rows, Σ $211M premium finite |
| `/api/market/gex-positioning` | 200 | ~4.4s | — | no nulls |
| `/api/market/gex-heatmap` | 200 | ~0.5s | — | `overlays.flow_by_strike`, `nighthawk_context` null (optional overlays) |
| `/api/market/nighthawk/edition` | 200 | ~0.1s | — | 3 plays 2026-06-30 |
| `/api/grid/*` (8 panels) | 200 | 55–1712ms | ✅ | all finite; analysts/congress/dark-pool/sectors/movers/catalysts clean |

**Cross-tool GEX/SPX agreement:** desk spot vs Polygon oracle within 0.02 pts; GEX positioning finite; heatmap matrix 10×4 invariants pass.

### Missing-field audit (API-backed — expected vs defect)

| Field / surface | Backing API | Cause | Action |
|---|---|---|---|
| `nope`, `nope_net_delta`, `dark_pool.pcr` on desk/merged/flows | UW upstream optional | **Upstream/data gap** — fields null in API during RTH | Expected when UW channel quiet; UI should show unavailable not fabricated |
| `spx_flows[].alert_rule`, `trade_count` | flow row optional metadata | **Expected** — not every alert has rule/count |
| `grid/earnings` `eps_actual`, `surprise_pct` | pre-report rows | **Expected** — future earnings have no actual yet |
| `grid/economy` `indicators[].rows[7].value` | macro series tail | **Expected** — trailing row may be unreleased |
| `gex-heatmap` `overlays.flow_by_strike` | overlay channel | **Expected off** when overlay not warmed |
| Browser premium pages | Clerk prod auth | **Blocked** — `+clerk_test` only works locally | API sweep covers data plane; browser UI sweep needs prod premium session |

### Browser sweep

- `/track-record` (public): fast load, no console errors, no `—` fields, static data (no live tick — expected).
- `/dashboard`, `/flows`, `/heatmap`, `/grid`, `/nighthawk`, `/terminal`: **blocked** — prod Clerk rejects test credentials; redirect to sign-in.

### Ops watch (not code bugs)

| ID | Item | Status |
|---|---|---|
| **OPS-6** | Railway `Grid-Warm-Cron` / `Flow-Ingest-Cron` cadence gaps (~30–60m between fires despite `*/2` / `* *` schedule) | Watch — manual `hit-cron` clears staleness; self-heal now covers grid-warm |
| **OPS-7** | Sentry unresolved `TypeError: fetch failed` (06:38 UTC) | Watch — no recent `error_events` spike |
| **OPS-8** | Prod browser RTH UI sweep | **DONE** pass 2 — premium Clerk ticket |

## ✅ Closed (2026-06-29 audit line)

| ID | Issue | Resolution |
|---|---|---|
| **P0 track-record** | `/api/track-record` disagreed with public ledger | **CLOSED #47** — `buildTrackRecordPagePayload()` from play ledger; smoke guard in `gha-http-smoke.mjs` |
| **P0 admin leaks** | Weak guards on debug/migration routes | **CLOSED #27** — `requireAdminApi()` |
| **P1-A** | Market-Regime-Detector cron not provisioned | **CLOSED** — Railway live; writes `market_regime` |
| **P1-B** | `/api/signals/open` unauthenticated | **CLOSED** — cron auth at route |
| **P1 GHA off-hours** | Deep audit false-failed on Postgres writer checks after close | **CLOSED #52 + #50** — skip off RTH |
| **P2-C** | SPX play ledger empty | **CLOSED** — Mon RTH BUY verified |
| **P2-D** | Options-socket off-hours 1006 loop | **CLOSED** — RTH-gated |
| **P2 provider monitoring gap** | Provider API errors visible in UI but no incident reconcile | **CLOSED** — `provider-health-reconcile` cron + admin Error Sink panel |
| **P2 error_events blind spot** | Durable errors had API route but no admin UI | **CLOSED** — Operations tab Error Sink panel |
| **P2 grid / regime / vendor / auth** | Various | **CLOSED** — see prior session table in git history |
| **P3 RTH automation** | Missing GitHub scheduled smokes | **CLOSED #46 + #50** — full weekday schedule + deploy smoke |
| **P3 audit SKILL drift** | Stale external probe paths | **CLOSED in-repo** — `AUDIT-SKILL-REFERENCE.md` + `.cursor/skills/platform-audit/SKILL.md` |

## 🔵 Remaining (ops / watch — not code bugs)

| ID | Item | Action |
|---|---|---|
| **OPS-1** | **`provider-health-reconcile` Railway service** | **DONE** — service live, TOML wired (`*/10 11-21 * * 1-5`), CRON_SECRET set |
| **OPS-2** | **`CRON_WATCHDOG_SELF_HEAL=1`** on `blackout-web` | **DONE** — set on Railway `blackout-web` |
| **OPS-3** | **Night Hawk edition cron** | Watch `nighthawk-playbook` during evening window; draft fixes in PR #56 |
| **OPS-4** | **`signal_outcomes` table** | Dead path after #47; optional schema cleanup |
| **OPS-5** | **External Cursor Cloud audit configs** | Copy from `.cursor/skills/platform-audit/SKILL.md` if tasks live outside this repo |

## Verified GREEN (2026-06-29 23:00 ET)

| Check | Result |
|---|---|
| `node scripts/gha-http-smoke.mjs` (prod) | ✅ track-record 3=3, SPX desk live |
| RTH deep audit (scheduled + manual) | ✅ GREEN |
