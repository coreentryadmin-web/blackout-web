#!/usr/bin/env node
/**
 * Live thesis-first quality probe — board + record + rejection funnel.
 * Read-only; one temp Clerk user deleted in finally.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

const BASE = (process.env.VALIDATE_BASE ?? "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.OUT ?? "/opt/cursor/artifacts/thesis-first-live";

function summarizeBoard(json) {
  const plays = json?.plays ?? json?.board?.plays ?? [];
  const setups = json?.setups ?? json?.board?.setups ?? [];
  const rows = plays.length ? plays : setups;
  const withThesis = rows.filter((r) => r.thesis_first);
  const multiRail = withThesis.filter((r) => (r.thesis_first?.thesis?.systems_aligned ?? 0) >= 2);
  const blocked = rows.filter((r) => (r.thesis_gate_blocks?.length ?? 0) > 0);
  const origins = {};
  for (const r of rows) {
    const o = (r.discovery_origin ?? r.origin ?? []).join?.("+") ?? String(r.discovery_origin ?? "?");
    origins[o] = (origins[o] ?? 0) + 1;
  }
  const archetypes = {};
  for (const r of withThesis) {
    const a = r.thesis_first?.thesis?.trade_archetype ?? "?";
    archetypes[a] = (archetypes[a] ?? 0) + 1;
  }
  return {
    row_count: rows.length,
    committed_or_visible: plays.length,
    with_thesis_first: withThesis.length,
    multi_rail_aligned_2plus: multiRail.length,
    thesis_gate_blocked: blocked.length,
    discovery_origin_mix: origins,
    archetype_mix: archetypes,
    sample: withThesis.slice(0, 5).map((r) => ({
      ticker: r.ticker,
      direction: r.direction,
      systems_aligned: r.thesis_first?.thesis?.systems_aligned,
      archetype: r.thesis_first?.thesis?.trade_archetype,
      rank_tier: r.thesis_first?.rank_tier,
      rails_fired: r.thesis_first?.thesis?.rails_fired,
      expression_dte: r.thesis_first?.expression?.dte_target,
      thesis_gate_blocks: r.thesis_gate_blocks ?? [],
    })),
  };
}

function summarizeRecord(json) {
  const rows = json?.rows ?? json?.record ?? [];
  const withThesis = rows.filter((r) => r.entry_context?.thesis_first);
  const multiOrigin = rows.filter((r) => {
    const o = r.entry_context?.origin_maps?.origin_direction_map ?? r.discovery_origin;
    if (Array.isArray(o)) return o.length > 1 || String(o).includes("+");
    return false;
  });
  return {
    graded_rows: rows.length,
    with_thesis_first_context: withThesis.length,
    multi_origin_commits: multiOrigin.length,
    today_commits: rows.filter((r) => r.session_date === json?.session_date).length,
    thesis_samples: withThesis.slice(-5).map((r) => ({
      ticker: r.ticker,
      session_date: r.session_date,
      archetype: r.entry_context?.thesis_first?.trade_archetype,
      systems_aligned: r.entry_context?.thesis_first?.systems_aligned,
      rails: r.entry_context?.thesis_first?.rails_fired,
      expression_dte: r.entry_context?.thesis_first?.expression_dte,
    })),
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const report = { base: BASE, at: new Date().toISOString(), board: null, record: null, verdict: "UNKNOWN" };

  try {
    const board = await fetchAuditJson(BASE, "/api/market/zerodte/board");
    report.board_http = { ok: board.ok, status: board.status, via: board.via };
    if (board.ok) report.board = summarizeBoard(board.json);

    const record = await fetchAuditJson(BASE, "/api/market/zerodte/record?days=3");
    report.record_http = { ok: record.ok, status: record.status, via: record.via };
    if (record.ok) report.record = summarizeRecord(record.json);

    const b = report.board;
    const r = report.record;
    if (!board.ok) report.verdict = "RED — board unreachable";
    else if (b?.with_thesis_first === 0 && b?.row_count > 0)
      report.verdict = "AMBER — board rows present but no thesis_first stamped (old task or shadow-only path)";
    else if (b?.with_thesis_first > 0 && b?.multi_rail_aligned_2plus >= 1)
      report.verdict = "GREEN — thesis-first live with multi-rail alignment visible";
    else if (b?.with_thesis_first > 0)
      report.verdict = "AMBER — thesis-first stamped but mostly single-rail (session still thin or gates strict)";
    else report.verdict = "AMBER — empty or pre-scan board";

    if (r?.with_thesis_first_context > 0) {
      report.verdict += ` | record thesis commits=${r.with_thesis_first_context}`;
    }

    writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.verdict.startsWith("RED") ? 1 : 0);
  } finally {
    await releaseAuditClerkSession();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
