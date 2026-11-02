/**
 * Registry job key → production cron service display name.
 * Used by railway-apply-cron-config.mjs and railway-audit-apply.mjs.
 */
export const CRON_SERVICE_NAMES = {
  "alert-outcome-sync": "Alert-Outcome-Sync",
  "cron-staleness-watchdog": "Cron-Staleness-Watchdog",
  "db-cleanup": "DB_CLEANUP",
  "data-correctness": "Data-Correctness-Cron",
  "data-integrity": "Data-Integrity-Cron",
  "flow-ingest": "Flow-Ingest-Cron",
  "gex-alerts": "GEX-Alerts",
  "gex-eod-snapshot": "GEX-EOD-Snapshot",
  "zerodte-warm": "ZeroDTE-Warm-Cron",
  "zerodte-grade": "ZeroDTE-Grade-Cron",
  "heatmap-warm": "heatmap-warm",
  "helix-signal-outcomes": "Helix-Signal-Outcomes",
  "meridian-warm": "Meridian-Warm",
  "desk-warm": "SPX-Desk-Warm",
  "largo-cleanup": "Largo-Chat-CleanUp",
  "largo-morning-brief": "Largo-Morning-Brief",
  "market-regime-detector": "Market-Regime-Detector",
  "membership-reconcile": "Membership-Reconcile",
  "welcome-sequence": "Welcome-Sequence",
  "nighthawk-morning-confirm": "NightHawk-Morning-Confirm",
  "nighthawk-outcomes": "NightHawk-Outcomes-Cron",
  "nighthawk-playbook": "NightHawk-Playbook",
  "provider-health-reconcile": "provider-health-reconcile",
  "socket-health": "Socket-Health-Cron",
  "spx-evaluate": "SPX-Engine-Evaluation",
  "spx-issues-sync": "SPX-Issues-Sync",
  "spx-signal-observe": "SPX-Signal-Observe",
  "spx-signal-weight-optimize": "SPX-Signal-Weight-Optimize",
  "uw-cache-refresh": "UW-Cache-Refresh-New",
  "vector-universe-snapshot": "Vector-Universe-Snapshot",
  "vector-full-state-snapshot": "Vector-Full-State-Snapshot",
  "vector-dark-pool-warm": "Vector-Dark-Pool-Warm",
  "vector-pick-sweep": "Vector-Pick-Sweep",
  "vector-walls-warm": "Vector-Walls-Warm",
  "vector-alerts": "Vector-Alerts",
  "vector-bead-record": "Vector-Bead-Record",
  "bie-full-state-snapshot": "BIE-Full-State-Snapshot",
  "coaching-alerts": "Coaching-Alerts",
  "platform-warm": "Platform-Warm",
  // Swing lane crons (railway.swing-discovery.toml / railway.swing-active-refresh.toml). These were in
  // cron-registry.ts + had live routes since PR-13 (#1046) but were never added to this EventBridge
  // schedule catalog, so neither fired in prod — the direct cause of the permanently-empty SWING board
  // (2026-07-29: 38/38 FailedInvocations). TOMLs landed on main via swing-followups; this registry
  // entry is what blackout-infra sync-cron-schedules.mjs needs to provision EventBridge rules.
  "swing-discovery": "Swing-Discovery",
  "swing-active-refresh": "Swing-Active-Refresh",
  "legacy-live-sync": "Legacy-Live-Sync",
  // These 8 keys are registered in src/lib/cron-registry.ts, have live routes that call
  // logCronRun() with this exact job_key, and (x-analytics aside) a railway.<key>.toml — but
  // were never added here. Found 2026-11-02: ops-collect-action-items.mjs's "cron never fired"
  // detector (postgresItems()'s zeroRuns check) builds its Postgres query's job list ENTIRELY
  // from ALL_CRON_KEYS (= Object.keys(CRON_SERVICE_NAMES)), so any of these 8 crons silently
  // losing its EventBridge schedule (zero rows ever written to cron_job_runs) would never raise
  // the P0 "cron:<key>:never-fired" alert that catches that exact failure for every other cron —
  // a monitoring blind spot, not a false alarm. Confirmed via
  // `node scripts/validate-railway-cron-manifest.mjs` (a separate, already-existing checker for
  // this same registry<->service-map alignment) reporting all 8 as
  // "missing from CRON_SERVICE_NAMES" against current cron-registry.ts.
  "banger-discovery": "Banger-Discovery",
  "banger-live-sync": "Banger-Live-Sync",
  "darkpool-discord": "Darkpool-Discord",
  "helix-discord-digest": "Helix-Discord-Digest",
  "nighthawk-backfill-repair": "NightHawk-Backfill-Repair",
  "thermal-discord": "Thermal-Discord",
  "x-analytics": "X-Analytics",
  "zerodte-skip-grade": "ZeroDTE-Skip-Grade",
};

/** All cron job keys that have a cron config railway.<key>.toml in the repo. */
export const ALL_CRON_KEYS = Object.keys(CRON_SERVICE_NAMES);

export const INTERNAL_CRON_BASE =
  process.env.RAILWAY_INTERNAL_CRON_BASE ?? "http://blackout-web.railway.internal:8080";

export const PRODUCTION_PROJECT_ID =
  process.env.RAILWAY_PROJECT_ID ?? "9282f541-a288-4c8b-a174-ee22016f4b1a";

export const PRODUCTION_ENV = process.env.RAILWAY_ENVIRONMENT ?? "production";
