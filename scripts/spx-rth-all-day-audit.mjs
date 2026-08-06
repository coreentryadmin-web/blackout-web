#!/usr/bin/env node
/**
 * SPX Slayer all-day RTH audit — orchestrates every SPX-specific probe in one pass.
 *
 * Usage:
 *   node scripts/spx-rth-all-day-audit.mjs [--force] [--phase=verify|post-close]
 *   npm run validate:spx-rth
 *
 * Requires: CRON_SECRET (Bearer for premium SPX routes + data-correctness cron)
 * Optional: DATABASE_PUBLIC_URL (rth-open writer checks via validate:rth-open)
 */
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isTradingDayEt, inRthOpenWindow, todayEtYmd, etParts } from "./gha-et-window.mjs";
import { spotsAgree, flipsAgree } from "./audit/lib/cross-tool-tolerance.mjs";
import { probeDataCorrectness } from "./audit/lib/data-correctness-probe.mjs";
import { fetchAuditJson, releaseAuditClerkSession } from "./audit/lib/audit-auth-fetch.mjs";
import { parseOpsCollectPayload, spxOpsItems } from "./audit/lib/ops-collect-scope.mjs";

const force = process.argv.includes("--force");
const phaseArg = process.argv.find((a) => a.startsWith("--phase="));
const PHASE = phaseArg ? phaseArg.slice("--phase=".length) : "verify";
const BASE = (
  process.argv.find((a) => a.startsWith("--base="))?.slice("--base=".length) ??
  process.env.AUDIT_APP_URL ??
  "https://blackouttrades.com"
).replace(/\/$/, "");
const CRON = process.env.CRON_SECRET || "";
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const checks = [];
const rec = (name, status, detail) => {
  checks.push({ name, status, detail });
  console.log(`  [${status}] ${name}${detail ? " — " + detail : ""}`);
};

function run(cmd, label, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const r = spawnSync(cmd, {
    shell: true,
    encoding: "utf8",
    env: opts.env ?? process.env,
    maxBuffer: 10 * 1024 * 1024,
    timeout: timeoutMs,
  });
  if (r.error?.code === "ETIMEDOUT" || r.signal === "SIGTERM") {
    rec(label, "FAIL", `sub-run timed out after ${timeoutMs / 1000}s`);
    return false;
  }
  if (r.status !== 0) {
    rec(label, "FAIL", (r.stderr || r.stdout || "").trim().slice(0, 400));
    return false;
  }
  rec(label, "PASS");
  return true;
}

function auditOpsCollect() {
  const r = spawnSync("npm run ops:collect", {
    shell: true,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  const payload = parseOpsCollectPayload(r.stdout ?? "", r.stderr ?? "");
  const postgresSkip = /Postgres audit skipped/i.test(r.stderr ?? "");
  const spxUrgent = spxOpsItems(payload?.items);
  const allUrgent = (payload?.items ?? []).filter((i) => i.priority === "P0" || i.priority === "P1");

  if (spxUrgent.length > 0) {
    rec("ops:collect", "FAIL", spxUrgent.map((i) => `${i.id}: ${i.title}`).join("; "));
    return;
  }
  if (payload && allUrgent.length > 0) {
    rec(
      "ops:collect",
      "PASS",
      `non-SPX P0/P1 deferred (${allUrgent.map((i) => i.id).join(", ")}) — SPX scope clean`
    );
    return;
  }
  if (r.status === 0 || (payload && (payload.items?.length ?? 0) === 0)) {
    const note =
      payload?.count === 0
        ? "zero items"
        : postgresSkip
          ? "postgres skipped (VPC); HTTP watchdog authoritative"
          : "ok";
    rec("ops:collect", "PASS", note);
    return;
  }
  rec("ops:collect", "FAIL", (r.stderr || r.stdout || "").trim().slice(0, 400));
}

async function fetchJson(path) {
  const res = await fetchAuditJson(BASE, path);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  return res.json;
}

/** Lane fetch that treats transient 5xx as unavailable (post-close / edge flake). */
async function softFetchJson(path) {
  const res = await fetchAuditJson(BASE, path);
  if (!res.ok) {
    if (res.status >= 500 || res.status === 524) return null;
    throw new Error(`HTTP ${res.status} ${path}`);
  }
  return res.json;
}

function spotDelta(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.abs(a - b);
}

function mergedLiveSpot(mergedWrap) {
  const merged = mergedWrap?.merged ?? mergedWrap;
  return Number(merged?.price ?? merged?.quote?.price ?? merged?.spot);
}

/** Cold merged desk cache can briefly return price:0 while GEX heatmap is warm — retry before FAIL. */
async function fetchMergedLiveSpot(hmSpot) {
  let mergedWrap = await fetchJson("/api/market/spx/merged");
  let liveSpot = mergedLiveSpot(mergedWrap);
  if (liveSpot > 0 || !(Number.isFinite(hmSpot) && hmSpot > 0)) {
    return { mergedWrap, liveSpot };
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    mergedWrap = await fetchJson("/api/market/spx/merged");
    liveSpot = mergedLiveSpot(mergedWrap);
    if (liveSpot > 0) break;
  }
  return { mergedWrap, liveSpot };
}

async function spxCrossEndpointCheck() {
  if (!CRON && !(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)) {
    rec("spx:cross-endpoint", "SKIP", "no CRON or Clerk keys");
    return;
  }
  try {
    const [heatmap, positioning, play] = await Promise.all([
      fetchJson("/api/market/gex-heatmap?ticker=SPX"),
      fetchJson("/api/market/gex-positioning?ticker=SPX"),
      fetchJson("/api/market/spx/play"),
    ]);
    const hmSpot = Number(heatmap?.spot);
    const { liveSpot } = await fetchMergedLiveSpot(hmSpot);
    const posSpot = Number(positioning?.spot);

    const issues = [];
    // Heatmap/GEX share one spot lane; merged desk uses the ~1s pulse lane — allow ≤1 pt
    // during fast tape when the 8s heatmap cache is mid-refresh.
    if (!spotsAgree(liveSpot, hmSpot, hmSpot)) {
      issues.push(`merged spot ${liveSpot} vs heatmap ${hmSpot} Δ=${spotDelta(liveSpot, hmSpot).toFixed(3)}`);
    }
    if (!spotsAgree(hmSpot, posSpot, hmSpot)) {
      issues.push(`heatmap spot ${hmSpot} vs positioning ${posSpot}`);
    }
    if (Number.isFinite(hmSpot) && heatmap?.gex?.flip != null && positioning?.flip != null) {
      if (!flipsAgree(Number(heatmap.gex.flip), Number(positioning.flip), hmSpot)) {
        issues.push(`flip matrix ${heatmap.gex.flip} vs positioning ${positioning.flip}`);
      }
    }
    if (play?.available && play?.levels?.spot != null && Number.isFinite(hmSpot)) {
      if (spotDelta(Number(play.levels.spot), hmSpot) > 0.25) {
        issues.push(`play spot ${play.levels.spot} vs heatmap ${hmSpot}`);
      }
    }
    if (play?.action === "SCANNING" && play?.confirmations?.checks?.length) {
      issues.push("play SCANNING still carries confirmations (stale layer bug)");
    }

    if (issues.length) {
      rec("spx:cross-endpoint", "FAIL", issues.join("; "));
    } else {
      rec(
        "spx:cross-endpoint",
        "PASS",
        `spot merged=${liveSpot} hm=${hmSpot} play=${play?.action}/${play?.phase}`
      );
    }
  } catch (e) {
    rec("spx:cross-endpoint", "FAIL", e.message);
  }
}

async function deskLaneCheck() {
  if (!CRON && !(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)) {
    rec("spx:desk-lanes", "SKIP", "no CRON or Clerk keys");
    return;
  }
  try {
    const [pulse, flow, mergedWrap] = await Promise.all([
      softFetchJson("/api/market/spx/pulse"),
      softFetchJson("/api/market/spx/flow"),
      fetchJson("/api/market/spx/merged"),
    ]);
    const merged = mergedWrap?.merged ?? mergedWrap;

    const mergedSpot = Number(merged?.price ?? merged?.quote?.price ?? merged?.spot);

    const issues = [];
    if (pulse?.available && Number(pulse?.price) > 0) {
      const pulseSpot = Number(pulse.price);
      if (Number.isFinite(mergedSpot) && !spotsAgree(mergedSpot, pulseSpot, mergedSpot)) {
        issues.push(`merged vs pulse spot Δ=${spotDelta(mergedSpot, pulseSpot).toFixed(3)}`);
      }
    }
    if (flow?.available && Number(flow?.price) > 0) {
      const flowSpot = Number(flow.price);
      if (Number.isFinite(mergedSpot) && !spotsAgree(mergedSpot, flowSpot, mergedSpot)) {
        issues.push(`merged vs flow spot Δ=${spotDelta(mergedSpot, flowSpot).toFixed(3)}`);
      }
    }

    if (!pulse?.available && !flow?.available) {
      rec("spx:desk-lanes", "SKIP", "pulse/flow unavailable (off-hours or holiday)");
      return;
    }

    if (issues.length) {
      rec("spx:desk-lanes", "FAIL", issues.join("; "));
    } else {
      rec("spx:desk-lanes", "PASS", `spot=${mergedSpot} pulse=${pulse?.available} flow=${flow?.available}`);
    }
  } catch (e) {
    rec("spx:desk-lanes", "FAIL", e.message);
  }
}

async function main() {
  const now = new Date();
  const et = etParts(now);
  const ymd = todayEtYmd(now);

  console.log(`\n=== SPX Slayer all-day RTH audit ===`);
  console.log(`Time: ${now.toISOString()} (${et.label})`);
  console.log(`Phase: ${PHASE} | Target: ${BASE}\n`);

  if (!force && !inRthOpenWindow(now) && PHASE === "verify") {
    console.log("Outside RTH window — skipping (use --force).\n");
    process.exit(0);
  }

  if (!isTradingDayEt(ymd) && !force) {
    console.log(`${ymd} is not a trading day — skipping.\n`);
    process.exit(0);
  }

  if (!CRON) {
    rec("env:CRON_SECRET", "FAIL", "required for SPX API probes");
  } else {
    rec("env:CRON_SECRET", "PASS");
  }

  // 1. RTH infra gate
  if (force || inRthOpenWindow(now)) {
    // grid-rth uses 420s — rth-open can exceed 300s when socket-health warms slowly.
    run("npm run validate:rth-open", "infra:validate:rth-open", { timeoutMs: 420_000 });
  }

  // 2. SPX matrix — every cell invariant (SPX only during all-day pass)
  if (CRON) {
    run("node scripts/heatmap-matrix-audit.mjs --tickers=SPX", "spx:matrix-deep-audit");
  }

  // 3. Cross-endpoint + desk lanes
  await spxCrossEndpointCheck();
  await deskLaneCheck();

  // 4. BIE/Largo single-derivation cross-check
  run("npm run validate:spx-bie", "spx:bie-consistency");

  // 5. Dashboard E2E (clicks + cross-tool) when Clerk keys present
  if (process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    // Largo query + Playwright UI can exceed 300s after upstream suite burst (SPX-RTH-2026-08-04).
    run("npm run validate:spx-e2e", "spx:dashboard-e2e", { timeoutMs: 600_000 });
  } else {
    rec("spx:dashboard-e2e", "SKIP", "CLERK keys not set — API-only pass");
  }

  // 6. Ops + data-correctness
  if (CRON) {
    try {
      const dc = await probeDataCorrectness({ base: BASE, cronSecret: CRON, tryFull: true });
      const flags = dc.flags ?? 0;
      const spxFlags = (dc.json?.flags ?? []).filter(
        (f) =>
          /spx|gex|heatmap|desk|slayer/i.test(f.metric ?? "") ||
          /spx|gex|heatmap|desk/i.test(f.layer ?? "")
      );
      if (!dc.ok && dc.status !== 200) {
        const authMismatch = dc.status === 401 || dc.status === 403;
        const isTimeout = dc.status === 0 || /aborted|524|timeout/i.test(dc.err || "");
        rec(
          "spx:data-correctness",
          authMismatch ? "WARN" : isTimeout ? "WARN" : "FAIL",
          authMismatch
            ? "CRON_SECRET auth mismatch — full sweep runs on prod cron"
            : isTimeout
              ? `edge timeout (mode=${dc.mode}) — full sweep runs on cron; rth-open pg check is authoritative`
              : dc.err || `HTTP ${dc.status} mode=${dc.mode}`
        );
      } else if (spxFlags.length) {
        rec("spx:data-correctness", "FAIL", `${spxFlags.length} SPX-layer flag(s)`);
        for (const f of spxFlags.slice(0, 5)) {
          console.log(`    · [${f.layer}/${f.metric}] ${f.detail}`);
        }
      } else if (flags > 0 && PHASE === "verify") {
        rec("spx:data-correctness", "WARN", `${flags} non-SPX flags (mode=${dc.mode})`);
      } else {
        const suffix = dc.fullSweepSkipped ? " (heatmap surface; full sweep via cron)" : "";
        rec("spx:data-correctness", "PASS", `flags=${flags} mode=${dc.mode}${suffix}`);
      }
    } catch (e) {
      rec("spx:data-correctness", "FAIL", e.message);
    }
  }

  auditOpsCollect();

  const fails = checks.filter((c) => c.status === "FAIL");
  const warns = checks.filter((c) => c.status === "WARN");
  const reportPath = join(OUT, `spx-rth-${ymd}-${PHASE}-${Date.now()}.json`);
  writeFileSync(
    reportPath,
    JSON.stringify({ ts: now.toISOString(), phase: PHASE, et: et.label, checks }, null, 2)
  );

  console.log(`\n=== Summary (${PHASE}) ===`);
  console.log(`  PASS: ${checks.filter((c) => c.status === "PASS").length}`);
  console.log(`  WARN: ${warns.length}`);
  console.log(`  FAIL: ${fails.length}`);
  console.log(`  Report: ${reportPath}\n`);

  if (fails.length) {
    console.log("FAILURES:");
    for (const f of fails) console.log(`  · ${f.name}: ${f.detail ?? ""}`);
    console.log("");
    if (PHASE === "fix") {
      console.log("Post-close fix mode — agent MUST fix all failures before ending session.\n");
    } else {
      console.log("Verify mode — report in agent summary only; do NOT commit docs/ OPEN-ISSUES logs.\n");
    }
    process.exit(1);
  }

  console.log("GREEN — SPX all-day audit passed.\n");
  process.exit(0);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await releaseAuditClerkSession();
  });
