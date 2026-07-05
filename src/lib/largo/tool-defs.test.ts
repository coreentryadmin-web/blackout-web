import { test } from "node:test";
import assert from "node:assert/strict";
import { BIE_TOOL_NAMES, LARGO_TOOL_DEFS, SPX_ENGINE_TOOL_NAMES, TOOL_GROUPS } from "./tool-defs";

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

// ── Task #147: get_zerodte_rejections — the 0DTE Command near-miss/gate-rejection
// log, distinct from BOTH get_zerodte_plays (committed-only, same scanner) and
// SPX Slayer's own get_spx_engine_snapshots (task #108, a different engine
// entirely). Locks in the disambiguating language so a future edit can't quietly
// drop it and reintroduce the exact name-confusion risk task #127 fixed.

test("get_zerodte_rejections is a real tool, reachable via TOOL_GROUPS.platform alongside get_zerodte_plays", () => {
  const def = LARGO_TOOL_DEFS.find((t) => t.name === "get_zerodte_rejections");
  assert.ok(def, "get_zerodte_rejections must be a registered Largo tool");
  assert.ok(
    TOOL_GROUPS.platform.includes("get_zerodte_rejections"),
    "get_zerodte_rejections must be routed via TOOL_GROUPS.platform — Largo would never call it otherwise"
  );
});

test("get_zerodte_rejections description disambiguates from BOTH get_zerodte_plays and SPX Slayer's get_spx_engine_snapshots", () => {
  const def = LARGO_TOOL_DEFS.find((t) => t.name === "get_zerodte_rejections");
  assert.ok(def);
  assert.match(
    def!.description,
    /get_zerodte_plays/,
    "expected get_zerodte_rejections description to reference get_zerodte_plays (the committed-only sibling tool)"
  );
  assert.match(
    def!.description,
    /get_spx_engine_snapshots/,
    "expected get_zerodte_rejections description to point away from SPX Slayer's own get_spx_engine_snapshots"
  );
  assert.match(
    def!.description,
    /DIFFERENT/,
    "expected get_zerodte_rejections description to explicitly call out it is a different product from SPX Slayer"
  );
});

test("get_zerodte_plays description points forward to get_zerodte_rejections for a candidate that didn't make the board", () => {
  const def = LARGO_TOOL_DEFS.find((t) => t.name === "get_zerodte_plays");
  assert.ok(def);
  assert.match(
    def!.description,
    /get_zerodte_rejections/,
    "expected get_zerodte_plays to point to get_zerodte_rejections for candidates that failed a gate"
  );
});
