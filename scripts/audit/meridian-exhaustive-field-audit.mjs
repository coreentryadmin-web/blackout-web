#!/usr/bin/env node
/**
 * Meridian EXHAUSTIVE walkthrough — API + field sanity across many events.
 * Complements UI harnesses: validates every numeric leaf in the payload and
 * cross-panel coherence for each event a member would open.
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

const BASE = process.env.VALIDATE_BASE ?? "https://blackouttrades.com";
const MAX_EARNINGS = Number(process.env.MERIDIAN_MAX ?? 12);
const MIN_IMP = Number(process.env.MERIDIAN_MIN_IMP ?? 3);

const findings = [];
const note = (severity, where, issue, detail = "") => {
  findings.push({ severity, where, issue, detail });
  console.log(`  [${severity}] ${where} — ${issue}${detail ? ` (${detail})` : ""}`);
};

function walkNumbers(node, path, out) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => walkNumbers(v, `${path}[${i}]`, out));
    return;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node)) walkNumbers(v, path ? `${path}.${k}` : k, out);
    return;
  }
  if (typeof node === "number") {
    out.push({ path, value: node });
    if (!Number.isFinite(node)) note("FAIL", path, "non-finite number", String(node));
    else if (Math.abs(node) >= 1000 && String(node).includes(".")) {
      const dec = String(node).split(".")[1] ?? "";
      if (dec.length > 4) note("WARN", path, "unrounded float noise", String(node));
    }
  }
}

function checkEarnings(ticker, d) {
  const where = ticker;
  const pack = d.pack;
  const enrich = d.enrichment;
  const intel = d.intel;

  if (pack?.history?.length && enrich?.print_history?.length === 0 && !enrich?.calendar_error) {
    note("FAIL", where, "coherence:history", "pack has prints, enrichment empty");
  }

  const cw = intel?.thermal?.call_wall ?? pack?.positioning?.call_wall;
  const pw = intel?.thermal?.put_wall ?? pack?.positioning?.put_wall;
  if (cw != null && pw != null && cw <= pw && !intel?.thermal?.walls_inverted) {
    note("FAIL", where, "coherence:walls", `call_wall ${cw} ≤ put_wall ${pw}`);
  }

  if (intel?.dark_pool?.available && !(intel.dark_pool.top_prints?.length > 0) && intel.dark_pool.total_premium > 0) {
    note("WARN", where, "dark_pool:tape_empty", `total_premium=${intel.dark_pool.total_premium} but no top_prints`);
  }

  if (intel?.expected_move_pct != null && (intel.expected_move_pct <= 0 || intel.expected_move_pct > 80)) {
    note("WARN", where, "expected_move:outlier", String(intel.expected_move_pct));
  }

  if (enrich?.corporate_guidance == null && enrich?.guidance_entitled === true && enrich?.guidance_on_file !== false) {
    note("WARN", where, "guidance:missing", "entitled but no guidance row");
  }

  const nums = [];
  walkNumbers(d, "", nums);
  return nums.length;
}

function checkMacro(label, d) {
  if (!d.report?.available) note("WARN", label, "macro report unavailable");
  if (d.spx_positioning?.available && d.spx_positioning.spot == null) {
    note("WARN", label, "SPX positioning available but spot null");
  }
}

async function main() {
  const timelineRes = await fetchAuditJson(BASE, "/api/market/meridian/timeline?days=21");
  const timeline = timelineRes?.json ?? timelineRes;
  const items = timeline?.items ?? [];

  const earnings = items
    .filter((i) => i.kind === "earnings" && i.ticker && (i.importance ?? 0) >= MIN_IMP)
    .slice(0, MAX_EARNINGS);
  const macro = items.filter((i) => i.kind === "macro").slice(0, 3);
  const opex = items.filter((i) => i.kind === "opex").slice(0, 1);
  const fda = items.filter((i) => i.kind === "fda").slice(0, 1);

  console.log(`\nMERIDIAN EXHAUSTIVE FIELD AUDIT`);
  console.log(`Earnings: ${earnings.length} · Macro: ${macro.length} · OpEx: ${opex.length} · FDA: ${fda.length}\n`);

  let tested = 0;
  let totalFields = 0;

  for (const ev of [...earnings, ...macro, ...opex, ...fda]) {
    const res = await fetchAuditJson(BASE, `/api/market/meridian/event?id=${encodeURIComponent(ev.id)}`);
    const detail = res?.json ?? res;
    if (!detail || res.ok === false) {
      note("FAIL", ev.ticker ?? ev.id, "event fetch failed", String(res?.status ?? "?"));
      continue;
    }
    tested += 1;
    if (detail.kind === "earnings") totalFields += checkEarnings(ev.ticker, detail);
    else if (detail.kind === "macro") checkMacro(detail.event ?? ev.id, detail);
    else note("INFO", ev.ticker ?? ev.kind, "non-earnings event loaded", detail.kind);
  }

  const fails = findings.filter((f) => f.severity === "FAIL").length;
  const warns = findings.filter((f) => f.severity === "WARN").length;
  console.log(`\n── SUMMARY ──`);
  console.log(`${tested} events · ${totalFields} numeric leaves scanned · ${fails} FAIL · ${warns} WARN`);
  await releaseAuditClerkSession();
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
