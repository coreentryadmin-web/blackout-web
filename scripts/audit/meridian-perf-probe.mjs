#!/usr/bin/env node
/**
 * Meridian navigation latency probe — measures timeline + event cold/warm on LIVE prod.
 * Read-only. One temp Clerk user, deleted in finally.
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

const BASE = process.env.VALIDATE_BASE ?? "https://blackouttrades.com";

async function timedFetch(label, path) {
  const t0 = performance.now();
  const res = await fetchAuditJson(BASE, path);
  const ms = Math.round(performance.now() - t0);
  const size = res.json ? JSON.stringify(res.json).length : 0;
  return { label, ms, ok: res.ok, status: res.status, size, via: res.via };
}

async function main() {
  try {
    const timeline = await timedFetch("timeline", "/api/market/meridian/timeline?days=21");
    const tlRes = await fetchAuditJson(BASE, "/api/market/meridian/timeline?days=21");
    const items = tlRes.json?.items ?? [];
    const earnings = items.find((i) => i.kind === "earnings");
    const macro = items.find((i) => i.kind === "macro");
    const results = [timeline];

    if (macro?.id) {
      const id = encodeURIComponent(macro.id);
      results.push(await timedFetch("event-macro-cold", `/api/market/meridian/event?id=${id}&_=${Date.now()}`));
      results.push(await timedFetch("event-macro-warm", `/api/market/meridian/event?id=${id}`));
    }

    if (earnings?.id) {
      const id = encodeURIComponent(earnings.id);
      const ticker = earnings.ticker ?? "?";
      results.push(
        await timedFetch(
          `event-earnings-cold (${ticker})`,
          `/api/market/meridian/event?id=${id}&_=${Date.now() + 1}`
        )
      );
      results.push(await timedFetch("event-earnings-warm", `/api/market/meridian/event?id=${id}`));
    }

    console.log("\nMeridian API latency (prod)\n");
    for (const r of results) {
      console.log(
        `${r.label.padEnd(32)} ${String(r.ms).padStart(5)}ms  ${r.ok ? "OK" : "FAIL"} ${r.status}  ${(r.size / 1024).toFixed(1)}KB  via=${r.via ?? "-"}`
      );
    }
  } finally {
    await releaseAuditClerkSession();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
