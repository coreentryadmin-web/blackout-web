import { test } from "node:test";
import assert from "node:assert/strict";
import { BIE_TOOL_NAMES, getToolsForIntent, LARGO_TOOL_DEFS, SPX_ENGINE_TOOL_NAMES, TOOL_GROUPS } from "./tool-defs";

test("BIE_TOOL_NAMES: every name is a real, callable Largo tool", () => {
  const known = new Set(LARGO_TOOL_DEFS.map((t) => t.name));
  for (const name of BIE_TOOL_NAMES) {
    assert.ok(known.has(name), `${name} is in BIE_TOOL_NAMES but not in LARGO_TOOL_DEFS`);
  }
});

test("BIE_TOOL_NAMES: every name is reachable through TOOL_GROUPS.platform", () => {
  for (const name of BIE_TOOL_NAMES) {
    assert.ok(
      TOOL_GROUPS.platform.includes(name),
      `${name} is in BIE_TOOL_NAMES but not routed via TOOL_GROUPS.platform — Largo would never call it`
    );
  }
});

test("BIE_TOOL_NAMES: no duplicates", () => {
  assert.equal(new Set(BIE_TOOL_NAMES).size, BIE_TOOL_NAMES.length);
});

// ── Task #112: SPX_ENGINE_TOOL_NAMES (calibration.ts's SPX-tool-calling cohort) ──

test("SPX_ENGINE_TOOL_NAMES: every name is a real, callable Largo tool", () => {
  const known = new Set(LARGO_TOOL_DEFS.map((t) => t.name));
  for (const name of SPX_ENGINE_TOOL_NAMES) {
    assert.ok(known.has(name), `${name} is in SPX_ENGINE_TOOL_NAMES but not in LARGO_TOOL_DEFS`);
  }
});

test("SPX_ENGINE_TOOL_NAMES: every name is a subset of TOOL_GROUPS.spx_desk", () => {
  for (const name of SPX_ENGINE_TOOL_NAMES) {
    assert.ok(
      (TOOL_GROUPS.spx_desk as readonly string[]).includes(name),
      `${name} is in SPX_ENGINE_TOOL_NAMES but not in TOOL_GROUPS.spx_desk — the cohort must stay a NARROWING of the desk bundle, never wander outside it`
    );
  }
});

test("SPX_ENGINE_TOOL_NAMES: excludes the generic ticker-scoped tools bundled into spx_desk for convenience", () => {
  // These take a ticker/group input and hit the same generic UW/Polygon providers
  // used for ANY ticker (see run-tool.ts) — a turn calling only these says nothing
  // about SPX-Slayer-engine-state answer quality specifically.
  for (const generic of ["get_flow_tape", "get_greek_flow", "get_gex", "get_group_greek_flow"]) {
    assert.ok(
      !SPX_ENGINE_TOOL_NAMES.includes(generic),
      `${generic} is generic/ticker-scoped and should not be in the SPX-engine-state cohort`
    );
  }
});

test("SPX_ENGINE_TOOL_NAMES: no duplicates", () => {
  assert.equal(new Set(SPX_ENGINE_TOOL_NAMES).size, SPX_ENGINE_TOOL_NAMES.length);
});

// ── Task #127: get_zerodte_plays vs get_spx_play mis-routing risk ──
// Both SPX Slayer and 0DTE Command ("BlackOut Grid") are branded "0DTE," but they
// are two independent engines (single-instrument SPX/SPXW vs. always-on multi-
// ticker scanner). get_zerodte_plays' description used to be a thin one-liner
// with no disambiguating clause at all — this locks in that the rewritten
// description explicitly tells Claude these are different engines and points to
// get_spx_play for SPX Slayer's own state, so a future edit can't silently drop it.

test("get_zerodte_plays description explicitly disambiguates from SPX Slayer's own tools", () => {
  const def = LARGO_TOOL_DEFS.find((t) => t.name === "get_zerodte_plays");
  assert.ok(def, "get_zerodte_plays must be a registered Largo tool");
  assert.match(
    def!.description,
    /different|DIFFERENT/,
    "expected get_zerodte_plays description to call out that it is a different engine from SPX Slayer"
  );
  assert.match(
    def!.description,
    /get_spx_play/,
    "expected get_zerodte_plays description to point to get_spx_play for SPX Slayer's own play state"
  );
  assert.match(
    def!.description,
    /multi-ticker|MULTI-TICKER/,
    "expected get_zerodte_plays description to state it scans across multiple tickers, not just SPX"
  );
});

// ── Task #130: 4 overlapping Largo flow tools (get_postgres_flows, get_flow_tape,
// get_options_flow, get_global_flow) had thin, non-disambiguating descriptions, and
// get_options_flow's "UW ONLY... No Polygon equivalent" claim was factually stale —
// its own run-tool.ts implementation merges 48h of HELIX/Postgres data
// (helix_session_alerts) for non-SPX tickers. Locks in that each rewritten
// description states its real data source and points at the other 3 by name, so a
// future edit can't silently regress back to thin one-liners.

function flowDef(name: string) {
  const def = LARGO_TOOL_DEFS.find((t) => t.name === name);
  assert.ok(def, `${name} must be a registered Largo tool`);
  return def!;
}

test("get_options_flow description no longer claims UW-only/no-Polygon-equivalent without qualification, and documents the real HELIX merge", () => {
  const def = flowDef("get_options_flow");
  // The old bare "UW ONLY ... No Polygon equivalent" framing implied ALL of this
  // tool's data comes from UW alone, which was already wrong for non-SPX tickers
  // (see run-tool.ts's helix.length merge) — the fix must not just delete that
  // phrase but explain the real per-branch sourcing.
  assert.match(def.description, /HELIX/, "expected the description to name HELIX as a real data source");
  assert.match(
    def.description,
    /Postgres/,
    "expected the description to say part of the merged data comes from Postgres"
  );
  assert.match(
    def.description,
    /helix_session_alerts/,
    "expected the description to name the actual response field that reveals HELIX contribution"
  );
  assert.match(
    def.description,
    /not\b.*purely UW-only|NOT purely UW-only/i,
    "expected an explicit correction that this is not purely UW-only data for non-SPX tickers"
  );
  // Still correctly required to take a ticker (unlike get_global_flow).
  assert.match(def.description, /REQUIRES a ticker/);
});

test("get_options_flow, get_global_flow, get_flow_tape, get_postgres_flows descriptions each name the other 3 tools for disambiguation", () => {
  const names = ["get_options_flow", "get_global_flow", "get_flow_tape", "get_postgres_flows"];
  for (const name of names) {
    const def = flowDef(name);
    const others = names.filter((n) => n !== name);
    for (const other of others) {
      assert.match(
        def.description,
        new RegExp(other),
        `expected ${name}'s description to reference ${other} for disambiguation`
      );
    }
  }
});

test("get_flow_tape description documents it is a strict superset of get_postgres_flows (same underlying fetch, plus aggregates)", () => {
  const def = flowDef("get_flow_tape");
  assert.match(def.description, /superset|SUPERSET/, "expected get_flow_tape to state the superset relationship");
  assert.match(def.description, /top_tickers/);
  assert.match(def.description, /total_premium/);
});

test("get_postgres_flows description documents it is the subset get_flow_tape's `recent` field mirrors", () => {
  const def = flowDef("get_postgres_flows");
  assert.match(def.description, /superset|SUPERSET/, "expected get_postgres_flows to state the superset relationship (from its side)");
  assert.match(def.description, /recent/, "expected reference to get_flow_tape's `recent` field");
});

test("get_global_flow description accurately keeps the UW-only/no-Postgres-merge claim (this one genuinely has no HELIX merge)", () => {
  const def = flowDef("get_global_flow");
  assert.match(def.description, /UW ONLY/);
  assert.match(def.description, /no Postgres\/HELIX merge|no Postgres merge/i);
});

test("get_options_flow and get_global_flow both document strike_stacks; get_flow_tape and get_postgres_flows both document they do NOT compute it", () => {
  assert.match(flowDef("get_options_flow").description, /strike_stacks/);
  assert.match(flowDef("get_global_flow").description, /strike_stacks/);
  assert.match(flowDef("get_flow_tape").description, /no strike_stacks/i);
  assert.match(flowDef("get_postgres_flows").description, /no strike_stacks/i);
});

// Task #130: FLOW_RE/FLOW_TOOLS_RE had no "flows"/"flowing" sibling for the bare
// "flow" token (unlike the pre-existing "sweep"/"sweeps" pair in the same
// alternation) — a plainly flow-related question phrased with either natural
// inflection and no known ticker previously dropped get_options_flow/
// get_global_flow/get_postgres_flows out of the tool ALLOWLIST entirely (this is
// the actual callable-tool-set test; question-intent.test.ts covers the parallel
// needsFlow soft-hint gap on the same regex).

test("'flows'/'flowing' phrasing puts get_options_flow/get_global_flow/get_postgres_flows on the allowlist (FLOW_TOOLS_RE plural/gerund gap)", () => {
  for (const question of ["any options flows building up today", "what's flowing on the tape lately"]) {
    const tools = getToolsForIntent(question);
    for (const name of ["get_options_flow", "get_global_flow", "get_postgres_flows", "get_flow_tape"]) {
      assert.ok(tools.includes(name), `expected ${name} on the allowlist for: "${question}"`);
    }
  }
});
