import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVectorPickEvidence } from "./vector-pick-evidence";

test("buildVectorPickEvidence: includes strike, flow, positioning, technicals when grounded", () => {
  const sections = buildVectorPickEvidence({
    side: "call",
    strike: 575,
    expiry: "2026-08-28",
    dte: 2,
    premium: 12.5,
    role: "flow-whale",
    targetStrike: 575,
    spot: 576,
    callWall: 580,
    putWall: 570,
    magnetStrike: 575,
    gammaFlip: 572,
    regimePosture: "long",
    technicals: { vwap: 576.5, emaStack: "up", rsi: 55, macd: "bull" },
    platformInputs: {
      sessionFlows: [{ option_type: "call", premium: 2_600_000, strike: 575, expiry: "2026-08-28" }],
      darkPoolLevels: [{ strike: 575, premium: 1_000_000, pct: 18 }],
    },
    confluenceZones: [{ center: 575, low: 574, high: 576, score: 8.5, kinds: ["call-wall", "max-pain"], levels: [] }],
    playStarred: ["Fade the 575 put wall", "Flip cross imminent"],
    caveat: undefined,
  });

  const ids = sections.map((s) => s.id);
  assert.ok(ids.includes("strike"));
  assert.ok(ids.includes("flow"));
  assert.ok(ids.includes("positioning"));
  assert.ok(ids.includes("structure"));
  assert.ok(ids.includes("technicals"));
  assert.ok(ids.includes("liquidity"));
  assert.ok(ids.includes("session"));

  const flow = sections.find((s) => s.id === "flow");
  assert.ok(flow?.items.some((i) => i.value.includes("2.6M")));
});

test("buildVectorPickEvidence: omits flow section when no tape data", () => {
  const sections = buildVectorPickEvidence({
    side: "put",
    strike: 100,
    expiry: "2026-08-28",
    dte: 2,
    premium: 3,
    role: "primary-short",
    targetStrike: 100,
    spot: 102,
    callWall: null,
    putWall: null,
    magnetStrike: null,
    gammaFlip: null,
    regimePosture: null,
    technicals: null,
    platformInputs: null,
    confluenceZones: null,
    playStarred: [],
  });
  assert.equal(sections.some((s) => s.id === "flow"), false);
  assert.equal(sections.some((s) => s.id === "technicals"), false);
});
