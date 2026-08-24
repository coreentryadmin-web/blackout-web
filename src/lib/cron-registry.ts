import { dteRangeLabel } from "@/lib/horizons";

const SWING_DTE_RANGE = dteRangeLabel("SWING");

export type CronJobKind = "http" | "worker";

export type CronJobDefinition = {
  key: string;
  name: string;
  kind: CronJobKind;
  path?: string;
  schedule_label: string;
  /** Minutes without a successful run before marked stale. */
  stale_after_min: number;
  /** Railway/EventBridge UTC cron — enables off-window stale suppression. */
  schedule_cron_utc?: string;
  weekdays_only?: boolean;
  market_hours_only?: boolean;
  description: string;
  /** True for crons that themselves produce a member-visible alert/signal/status badge when
   *  they run — NOT cache warmers (zerodte-warm, heatmap-warm) and NOT
   *  validators (data-correctness, data-integrity, provider-health-reconcile). Drives
   *  bie/missed-alerts.ts's outage detection — single source of truth so that list can't
   *  silently drift from the registry (was a hand-maintained duplicate list before). */
  produces_member_alert?: boolean;
};

export const CRON_JOBS: CronJobDefinition[] = [
  {
    key: "flow-ingest",
    name: "Flow Ingest",
    kind: "http",
    path: "/api/cron/flow-ingest",
    schedule_label: "~Every 2 min (market hours)",
    stale_after_min: 15,
    market_hours_only: true,
    description: "UW flow alerts → Postgres + live feed",
    produces_member_alert: true,
  },
  {
    key: "spx-evaluate",
    name: "SPX Engine",
    kind: "http",
    path: "/api/cron/spx-evaluate",
    schedule_label: "~Every 5 min (7AM–4PM ET)",
    stale_after_min: 20,
    weekdays_only: true,
    market_hours_only: true,
    description: "SPX play + lotto evaluation tick",
    produces_member_alert: true,
  },
  {
    key: "largo-cleanup",
    name: "Largo Cleanup",
    kind: "http",
    path: "/api/cron/largo-cleanup",
    schedule_label: "Weekly",
    stale_after_min: 10 * 24 * 60,
    description: "Purge stale Largo chat sessions",
  },
  {
    key: "largo-morning-brief",
    name: "Largo Morning Brief",
    kind: "http",
    path: "/api/cron/largo-morning-brief",
    schedule_label: "9:25 AM ET weekdays",
    // Mirrors railway.largo-morning-brief.toml dual-band — off-window stale suppression (ops #2565, #2569).
    schedule_cron_utc: "25 13,14 * * 1-5",
    stale_after_min: 24 * 60,
    weekdays_only: true,
    description: "Pre-open Largo summary push for opted-in members",
    produces_member_alert: true,
  },
  {
    key: "nighthawk-outcomes",
    name: "Night Hawk Outcomes",
    kind: "http",
    path: "/api/cron/nighthawk-outcomes",
    schedule_label: "4:30 PM ET weekdays",
    // Mirrors railway.nighthawk-outcomes.toml — off-window stale suppression (ops #1983).
    schedule_cron_utc: "30 20,21 * * 1-5",
    stale_after_min: 36 * 60,
    weekdays_only: true,
    description: "Resolve play target/stop vs next-day prices",
  },
  {
    key: "nighthawk-playbook",
    name: "Night Hawk Edition",
    kind: "worker",
    schedule_label: "5:30 PM ET weekdays",
    // Lowered 36h → 4h (#77 hardening D): the edition fires every 15 min across the evening window
    // and now dispatches fire-and-forget, so a published edition should land within a couple hours of
    // 5:30 PM ET. A 36h ceiling meant a fully dark night went unflagged until the NEXT evening; 4h
    // catches a missed/stuck build the same night.
    stale_after_min: 240,
    weekdays_only: true,
    path: "/api/cron/nighthawk-edition",
    description: "Full dossier pipeline → Claude plays → publish",
  },
  {
    key: "uw-cache-refresh",
    name: "UW Cache Refresh",
    kind: "http",
    path: "/api/cron/uw-cache-refresh",
    schedule_label: "Every 2 min",
    stale_after_min: 10,
    market_hours_only: true,
    description: "Pre-warm Redis cache for UW market-wide + index-ticker signals to stay under 120/min plan cap",
  },
  {
    key: "heatmap-warm",
    name: "Thermal Warm",
    kind: "http",
    path: "/api/cron/heatmap-warm",
    schedule_label: "Every 1 min EventBridge + in-app leader ~20s (market hours) + delta SSE",
    stale_after_min: 2,
    weekdays_only: true,
    market_hours_only: true,
    description: "Pre-warm GEX heatmap matrix for shared sticky universe (static ∪ dynamic ≤100/14d; SPY/SPX/QQQ forced first). EventBridge 1/min floor; rth-warm-leader backs up at ~20s; Thermal clients force-refresh when asof is stale",
  },
  {
    key: "platform-warm",
    name: "Platform Warm",
    kind: "http",
    path: "/api/cron/platform-warm",
    schedule_label: "~Every 5 min (24/7)",
    stale_after_min: 15,
    description: "Pre-warm general platform cache (bootstrap bundle) for 24/7 admin/member page loads outside RTH",
  },
  {
    key: "meridian-warm",
    name: "Meridian Warm",
    kind: "http",
    path: "/api/cron/meridian-warm",
    schedule_label: "~Every 5 min (extended warm window)",
    stale_after_min: 10,
    weekdays_only: true,
    market_hours_only: true,
    description:
      "Pre-warm Meridian catalyst timeline + Polygon SPX GEX matrix + SPX desk enrichment so member polls stay cache-reader (no UW REST fan-out per request)",
  },
  {
    key: "vector-walls-warm",
    name: "Vector Walls Warm",
    kind: "http",
    path: "/api/cron/vector-walls-warm",
    schedule_label: "Every 5 min EventBridge + in-app leader ~20s (market hours)",
    stale_after_min: 2,
    weekdays_only: true,
    market_hours_only: true,
    description:
      "Pre-warm Vector GEX/VEX walls cache so SSE stream (1Hz ticks) sees cache hits instead of expensive re-computation; EventBridge 5/min floor; rth-warm-leader backs up at ~20s; bead recording is vector-bead-record (5s leader)",
  },
  {
    key: "vector-bead-record",
    name: "Vector Bead Record",
    kind: "http",
    path: "/api/cron/vector-bead-record",
    schedule_label: "Every 1 min backup (market hours); in-app leader at 5s",
    stale_after_min: 1,
    weekdays_only: true,
    market_hours_only: true,
    description:
      "Record wall-history bead samples every 5s for the full shared universe (~100 tickers: static ∪ dynamic), viewer-independent — primary writer is vector-bead-recorder-leader; this cron is backup + audit",
  },
  {
    key: "desk-warm",
    name: "SPX Desk Warm",
    kind: "http",
    path: "/api/cron/desk-warm",
    schedule_label: "~Every 5 min (market hours; in-app leader at ~90s)",
    stale_after_min: 10,
    weekdays_only: true,
    market_hours_only: true,
    description: "Pre-warm SPX desk/flow/pulse cache lanes + SPX GEX matrix so dashboard polls are pure cache hits (no multi-second buildSpxDesk blocks)",
  },
  {
    key: "zerodte-warm",
    name: "0DTE Command Warm",
    kind: "http",
    path: "/api/cron/zerodte-warm",
    schedule_label: "~Every 5 min (market hours; in-app leader fills sub-5m gaps)",
    stale_after_min: 15,
    weekdays_only: true,
    market_hours_only: true,
    description: "Warms 0DTE Command's earnings-match cache (readGridEarnings, relocated from the deleted classic-Grid tool) and runs its always-on scanner tick (warmZeroDteBoard) so zerodte_setup_log stays current",
  },
  {
    key: "zerodte-grade",
    name: "0DTE Ledger Grade",
    kind: "http",
    path: "/api/cron/zerodte-grade",
    schedule_label: "Every 15 min post-close (16:00-18:00 ET band)",
    // Mirrors railway.zerodte-grade.toml — off-window stale suppression (ops #1331, #2565, #2569).
    schedule_cron_utc: "*/15 20-22 * * 1-5",
    stale_after_min: 6 * 60,
    weekdays_only: true,
    description:
      "Standalone zerodte_setup_log grading (gradeZeroDteLedger force=true) — decoupled from zerodte-warm so post-close rows grade promptly without the warm cron's 10-minute throttle",
  },
  {
    key: "swing-discovery",
    name: "Night Hawk Swing Discovery",
    kind: "http",
    path: "/api/cron/swing-discovery",
    // Phase-anchored (scan-cadence.ts): EventBridge fires on a wide band; the route resolves the active phase
    // (POST_CLOSE 4:15–8PM ET first, plus PRE_OPEN/MIDDAY/POWER_HOUR/OVERNIGHT) and runs ONCE per (day, phase).
    // Stale ceiling spans a full day since only one phase fires per window and off-phase firings self-skip.
    schedule_label: "Phase-anchored (post-close first; wide-band fire, route decides)",
    stale_after_min: 36 * 60,
    weekdays_only: true,
    description:
      `Whole-market swing (${SWING_DTE_RANGE}) discovery: two-tier flow+structure screen → dossiers → advances the cross-session accumulation memory (WATCH-only, commits nothing). Idempotent per (session day, phase).`,
  },
  {
    key: "swing-active-refresh",
    name: "Night Hawk Swing Refresh",
    kind: "http",
    path: "/api/cron/swing-active-refresh",
    schedule_label: "Every 15 min (market hours)",
    stale_after_min: 25,
    weekdays_only: true,
    market_hours_only: true,
    description:
      "Hourly refresh of held swing positions: appends an eod/tick snapshot per position + runs management sync (capital-preservation rungs act; edge rungs evidence-only). Never opens or closes a position (PR-15 rolls).",
  },
  {
    key: "gex-eod-snapshot",
    name: "GEX EOD Snapshot",
    kind: "http",
    path: "/api/cron/gex-eod-snapshot",
    schedule_label: "~4:10 PM ET weekdays (post-close)",
    // Mirrors railway.gex-eod-snapshot.toml — off-window stale suppression (ops #1983).
    schedule_cron_utc: "10 20,21 * * 1-5",
    stale_after_min: 36 * 60,
    weekdays_only: true,
    description: "Persist end-of-day GEX close levels to the rolling gex-eod:{ticker} list so Thermal can anchor day-over-day history",
  },
  {
    key: "gex-alerts",
    name: "GEX Regime Alerts",
    kind: "http",
    path: "/api/cron/gex-alerts",
    schedule_label: "~Every 5 min (market hours)",
    stale_after_min: 20,
    weekdays_only: true,
    market_hours_only: true,
    description: "Evaluate Thermal for major market-regime gamma events and broadcast web-push alerts (inert until GEX_ALERTS_PUSH + VAPID are set)",
    produces_member_alert: true,
  },
  {
    key: "vector-alerts",
    name: "Vector Alerts",
    kind: "http",
    path: "/api/cron/vector-alerts",
    schedule_label: "~Every 1-2 min (market hours)",
    stale_after_min: 10,
    weekdays_only: true,
    market_hours_only: true,
    description:
      "Server-side evaluation of members' persisted Vector wall-touch/flip-cross alert rules + sendWebPush delivery, so alerts reach a closed tab/phone (inert until VECTOR_ALERTS_PUSH + VAPID are set)",
    produces_member_alert: true,
  },
  {
    key: "db-cleanup",
    name: "DB Cleanup",
    kind: "http",
    path: "/api/cron/db-cleanup",
    schedule_label: "Nightly ~3 AM ET",
    stale_after_min: 36 * 60,
    description: "Prune high-volume Postgres tables (telemetry, flow, signal log, cron runs)",
  },
  {
    key: "membership-reconcile",
    name: "Membership Reconcile",
    kind: "http",
    path: "/api/cron/membership-reconcile",
    schedule_label: "Every 6h",
    stale_after_min: 13 * 60,
    description: "Resync Whop membership → Clerk tier; self-heals dropped webhooks (lockouts + revenue leaks)",
  },
  {
    key: "welcome-sequence",
    name: "Welcome Sequence",
    kind: "http",
    path: "/api/cron/welcome-sequence",
    schedule_label: "Hourly",
    // Steps are 2 DAYS apart, so hourly granularity is far finer than the drip needs — the
    // margin exists so a few missed firings never delay a step by a whole day. Stale after 3h
    // (3 missed runs) rather than ~1h: this is the watchdog's ONLY visibility into the drip,
    // and without a registry entry an unscheduled cron is structurally un-alertable (see
    // admin-cron-health.ts, which maps over CRON_JOBS).
    stale_after_min: 3 * 60,
    description: "Send the next due step of the 5-email member welcome drip (steps 2-5; step 1 fires inline from the Clerk user.created webhook)",
  },
  {
    key: "data-integrity",
    name: "Data Integrity",
    kind: "http",
    path: "/api/cron/data-integrity",
    schedule_label: "~Every 5 min (market hours)",
    stale_after_min: 20,
    weekdays_only: true,
    market_hours_only: true,
    description:
      "Cross-validate live numbers across every tool (desk vs heatmap vs quote, SPY/SPX tracking, max-pain scaling, desk internal math, GEX freshness) — auto-opens admin incidents on any discrepancy",
  },
  {
    key: "provider-health-reconcile",
    name: "Provider Health Reconcile",
    kind: "http",
    path: "/api/cron/provider-health-reconcile",
    schedule_label: "~Every 10 min (market hours)",
    stale_after_min: 25,
    weekdays_only: true,
    market_hours_only: true,
    description:
      "Roll up api_telemetry_events upstream failures and rate limits into admin incidents — catches sustained UW/Polygon/Anthropic outages without watching the dashboard",
  },
  {
    key: "spx-issues-sync",
    name: "SPX Issues Sync",
    kind: "http",
    path: "/api/cron/spx-issues-sync",
    schedule_label: "~Every 5 min (7AM–4PM ET)",
    stale_after_min: 20,
    weekdays_only: true,
    market_hours_only: true,
    description:
      "Computes SPX play/engine health issues (Claude arbiter veto, gate blocks/warnings, play-engine heartbeat silent/stale) and syncs them into admin_incidents — previously this only ran as a side effect of a human loading /api/admin/spx/dashboard, so BIE's discovery layer (fetchDiscoveryIncidents) went silently stale on SPX engine health whenever nobody was viewing that page",
  },
  {
    key: "data-correctness",
    name: "Data Correctness",
    kind: "http",
    path: "/api/cron/data-correctness",
    schedule_label: "~Every 30 min (market hours)",
    stale_after_min: 90,
    weekdays_only: true,
    market_hours_only: true,
    description:
      "Data-correctness auditor — independently re-derives Thermal GEX/VEX numbers (net/King/flip/walls) from the raw chain, asserts invariants/sanity/freshness, confirms SPX King + net-GEX sign against the UW oracle, and cross-checks getGexPositioning vs the SPX desk; FLAGs any wrong number to Discord",
  },
  {
    key: "cron-staleness-watchdog",
    name: "Cron Watchdog",
    kind: "http",
    path: "/api/cron/cron-staleness-watchdog",
    schedule_label: "Every 5 min",
    stale_after_min: 60,
    description: "Alerts Discord when any cron goes stale/failed (catches silent never-fired crons)",
  },
  {
    key: "socket-health",
    name: "Socket Health",
    kind: "http",
    path: "/api/cron/socket-health",
    schedule_label: "~Every 15 min (market hours)",
    stale_after_min: 25,
    weekdays_only: true,
    market_hours_only: true,
    description:
      "Boot lazy WS managers and report polygon/UW/options/LULD cluster status — used by RTH validation instead of log grep",
  },
  {
    key: "spx-signal-observe",
    name: "SPX Signal Observer",
    kind: "http",
    path: "/api/cron/spx-signal-observe",
    schedule_label: "Every 5 min (market hours)",
    stale_after_min: 30,
    weekdays_only: true,
    market_hours_only: true,
    description: "Snapshot all confluence signal weights + raw market values to spx_signal_observations; backfills 30-min outcomes for earlier rows",
  },
  {
    key: "spx-signal-weight-optimize",
    name: "SPX Signal Optimizer",
    kind: "http",
    path: "/api/cron/spx-signal-weight-optimize",
    // Names BOTH ET renderings, not just the UTC time. `cron-dst-audit.mjs`'s UTC-labelled check
    // asks exactly this — does the deployed label own the fact that its ET placement shifts an hour
    // across the changeover — and returned LABEL DRIFTS on the bare "Nightly 10 PM UTC". The job
    // itself is DST-correct by construction (no ET gate at all: its window is a rolling
    // `observed_at > now - 30 days`, absolute time), so the schedule is right and only the label
    // was short. Same form as x-analytics.
    schedule_label: "Nightly 10 PM UTC (6 PM ET in EDT, 5 PM ET in EST)",
    // Mirrors railway.spx-signal-weight-optimize.toml — off-window stale suppression (ops #1550).
    schedule_cron_utc: "0 22 * * 1-5",
    stale_after_min: 36 * 60,
    weekdays_only: true,
    description: "Compute per-signal directional accuracy vs baseline; write ranked alpha report to spx_signal_weight_reports",
  },
  {
    key: "nighthawk-morning-confirm",
    name: "Night Hawk Morning Confirm",
    kind: "http",
    path: "/api/cron/nighthawk-morning-confirm",
    schedule_label: "9:15 AM ET weekdays",
    // Mirrors railway.nighthawk-morning-confirm.toml — off-window stale suppression (ops #1983).
    schedule_cron_utc: "15 13,14 * * 1-5",
    stale_after_min: 36 * 60,
    weekdays_only: true,
    description: "Validates overnight Night Hawk plays vs pre-market SPX; writes CONFIRMED/DEGRADED/INVALIDATED status to Redis for UI badges",
    produces_member_alert: true,
  },
  {
    key: "market-regime-detector",
    name: "Market Regime Detector",
    kind: "http",
    path: "/api/cron/market-regime-detector",
    schedule_label: "~Every 5 min (market hours)",
    stale_after_min: 20,
    weekdays_only: true,
    market_hours_only: true,
    description:
      "Derives composite market regime (GEX/vol/trend/flow) from the SPX desk + HELIX flows and writes to market_regime + flow_anomalies tables — feeds FlowAnomalyBanner and Night Hawk morning confirm",
  },
  {
    key: "alert-outcome-sync",
    name: "Alert Outcome Sync",
    kind: "http",
    path: "/api/cron/alert-outcome-sync",
    schedule_label: "Every 6h",
    stale_after_min: 13 * 60,
    description:
      "Grades historical alert_audit_log rows by copying each row's already-computed outcome from its origin table (zerodte_setup_log/nighthawk_play_outcomes/spx_play_outcomes) — feeds BIE precedent search (get_similar_precedents), which was a complete no-op before this cron existed",
  },
  {
    key: "helix-signal-outcomes",
    name: "Helix Signal Outcomes",
    kind: "http",
    path: "/api/cron/helix-signal-outcomes",
    schedule_label: "~Every 15 min (market hours)",
    stale_after_min: 45,
    weekdays_only: true,
    market_hours_only: true,
    description:
      "Persists Helix velocity-spike/split-flow firings (same detection as the live /flows badges) and grades each one's 5m/15m/1h price outcome — Tier 2 evidence loop for Helix's own signal-grading infrastructure, which didn't exist before this cron (signals were computed live and thrown away)",
  },
  {
    key: "vector-universe-snapshot",
    name: "Vector Universe Snapshot",
    kind: "http",
    path: "/api/cron/vector-universe-snapshot",
    schedule_label: "~Every 5 min (market hours)",
    stale_after_min: 15,
    weekdays_only: true,
    market_hours_only: true,
    description:
      "Batch-build compact GEX wall summary rows for the Vector scanner (~21 liquid tickers) into Redis — keeps market-wide Vector reads cache-only",
  },
  {
    key: "vector-full-state-snapshot",
    name: "Vector Full-State Snapshot",
    kind: "http",
    path: "/api/cron/vector-full-state-snapshot",
    schedule_label: "~Every 5 min (market hours)",
    stale_after_min: 15,
    weekdays_only: true,
    market_hours_only: true,
    description:
      "Snapshot the COMPLETE Vector desk state (regime/walls/flip/magnet/max-pain/expected-move/ladder/heatmap/flow/beads/VEX/dark-pool/technicals/play) per universe ticker × DTE horizon into Redis, so Largo-BIE serves current Vector state for any stock/horizon cache-only without a per-query fan-out",
  },
  {
    key: "bie-full-state-snapshot",
    name: "BIE Full-State Snapshot",
    kind: "http",
    path: "/api/cron/bie-full-state-snapshot",
    schedule_label: "~Every 5 min (market hours)",
    stale_after_min: 15,
    weekdays_only: true,
    market_hours_only: true,
    description:
      "Assemble the broad cross-product platform snapshot (SPX desk + flow tape + Night Hawk + market-regime intel + Vector universe wall summary + market-wide dark pool + hot tickers) into Redis bie:full-state so BIE reads current whole-platform state instantly — the 24/7 'brain of BlackOut' feed",
  },
  {
    key: "vector-dark-pool-warm",
    name: "Vector Dark Pool Warm",
    kind: "http",
    path: "/api/cron/vector-dark-pool-warm",
    schedule_label: "~Every 10 min (market hours)",
    stale_after_min: 20,
    weekdays_only: true,
    market_hours_only: true,
    description:
      "Pre-warm UW dark-pool levels per overlay-allowlist ticker into Redis so Vector SSE never hits UW REST on the hot path",
  },
  {
    key: "coaching-alerts",
    name: "Coaching Alerts",
    kind: "http",
    path: "/api/cron/coaching-alerts",
    schedule_label: "~Every 10 min (market hours)",
    stale_after_min: 20,
    weekdays_only: true,
    market_hours_only: true,
    description:
      "Write SPX coaching alerts (VWAP / gamma walls / posture) to coaching_alerts — replaces the never-shipped position-coaching-monitor cron",
    produces_member_alert: true,
  },
  // ---------------------------------------------------------------------------
  // SIX JOBS THAT RUN AND LOG BUT HAD NO HEALTH ENTRY (added 2026-08-19).
  //
  // Each of these calls `logCronRun(<key>)` on every invocation and each has a real schedule in
  // blackout-infra's `terraform/modules/crons/cron-jobs.json` — they were simply never added here,
  // so `buildCronHealthSnapshot` never looked their run rows up and the board covered 40 of the 50
  // cron routes. A job absent from this list cannot be reported stale, failed, or dark: it is not
  // "healthy", it is unwatched. `banger-live-sync` marks the live banger board every 5 minutes
  // during the session and was among them.
  //
  // Every cadence and `schedule_cron_utc` below is copied from that infra file rather than inferred,
  // so the stale window matches the schedule that actually fires. `stale_after_min` is set to a few
  // times the interval, matching how the neighbouring entries are tuned — long enough that one
  // missed tick is not an alert, short enough that a dead job is caught the same session.
  //
  // The four `x-*` jobs already had pause handling in admin-cron-health.ts via
  // `X_MARKETING_CRON_KEYS` (exactly these four), which only makes sense for registry jobs — more
  // evidence they were meant to be here. When marketing is paused they relabel to
  // "Paused (X marketing env)" rather than going stale.
  // ---------------------------------------------------------------------------
  {
    key: "banger-discovery",
    name: "Banger Discovery",
    kind: "http",
    path: "/api/cron/banger-discovery",
    schedule_label: "4:15 PM ET weekdays (post-close)",
    // Daily job: a full day plus slack, so one missed evening is caught the next morning and a
    // weekend does not alert.
    stale_after_min: 1800,
    // TWO UTC hours: 20:15 is 16:15 ET under EDT, 21:15 is 16:15 ET under EST, so one fire always
    // lands after the 16:00 ET close. The route's inEtWindow guard skips the off-band fire (before
    // claiming the day, so the skip cannot lock out the good fire). Was `15 20 * * 1-5`, which ran
    // 45 min BEFORE the close all winter and committed positions off an unsettled tape.
    schedule_cron_utc: "15 20,21 * * 1-5",
    weekdays_only: true,
    description: "Whole-market banger scan → next-session candidates",
  },
  {
    key: "banger-live-sync",
    name: "Banger Live Sync",
    kind: "http",
    path: "/api/cron/banger-live-sync",
    schedule_label: "~Every 5 min (market hours)",
    stale_after_min: 20,
    schedule_cron_utc: "*/5 11-21 * * 1-5",
    weekdays_only: true,
    market_hours_only: true,
    description: "Live marks + outcome sync for the banger board",
    produces_member_alert: true,
  },
  {
    key: "x-intel",
    name: "X Intel Queue Writer",
    kind: "http",
    path: "/api/cron/x-intel",
    schedule_label: "Every 2h (same as x-autopost)",
    stale_after_min: 240,
    schedule_cron_utc: "0 12,14,16,18,20,22,0 * * *",
    description: "Generate X content candidates and write to review queue (never publishes)",
  },
  {
    key: "x-autopost",
    name: "X Autopost",
    kind: "http",
    path: "/api/cron/x-autopost",
    schedule_label: "Every 2h",
    stale_after_min: 240,
    schedule_cron_utc: "0 12,14,16,18,20,22,0 * * *",
    description: "Scheduled X posts (paused via X marketing env)",
  },
  {
    key: "x-growth",
    name: "X Growth",
    kind: "http",
    path: "/api/cron/x-growth",
    // Label states UTC, not ET, DELIBERATELY. 13:00-22:00 UTC is 9AM-6PM ET under EDT but
    // 8AM-5PM ET under EST — a fixed-UTC band cannot hold an ET clock year-round, so an ET label here
    // would be true for only half the year. Following spx-signal-weight-optimize's honest UTC label.
    schedule_label: "Hourly 13:00–22:00 UTC weekdays (9AM–6PM ET in EDT, 8AM–5PM ET in EST)",
    stale_after_min: 150,
    schedule_cron_utc: "0 13-22 * * 1-5",
    weekdays_only: true,
    description: "X growth pass — likes/follows/RT (paused via X marketing env)",
  },
  {
    key: "x-replies",
    name: "X Replies",
    kind: "http",
    path: "/api/cron/x-replies",
    // See x-growth: UTC label, because the ET equivalent moves with daylight saving.
    schedule_label: "Hourly :20 past, 13:00–22:00 UTC weekdays (9:20AM–6:20PM ET in EDT, an hour earlier in EST)",
    stale_after_min: 150,
    schedule_cron_utc: "20 13-22 * * 1-5",
    weekdays_only: true,
    description: "Reply to X mentions (paused via X marketing env)",
  },
  {
    key: "x-analytics",
    name: "X Analytics",
    kind: "http",
    path: "/api/cron/x-analytics",
    // See x-growth: UTC label. 23:30 UTC is 7:30 PM ET under EDT and 6:30 PM ET under EST.
    schedule_label: "Daily 23:30 UTC (7:30 PM ET in EDT, 6:30 PM ET in EST)",
    stale_after_min: 1800,
    schedule_cron_utc: "30 23 * * *",
    description: "Pull X post/profile metrics into analytics",
  },
];

export const CRON_JOB_BY_KEY = Object.fromEntries(CRON_JOBS.map((j) => [j.key, j])) as Record<
  string,
  CronJobDefinition
>;
