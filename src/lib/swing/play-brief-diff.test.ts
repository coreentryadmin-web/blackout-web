import test from "node:test";
import assert from "node:assert/strict";
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import {
  briefContentKey,
  diffBriefSnapshots,
  envelopeWithDiffSection,
  envelopeWithNarrativePulse,
  extrasFromBriefResponse,
  briefSnapshotStorageKey,
  loadPersistedBriefSnapshot,
  snapshotFromBrief,
} from "./play-brief-diff";

function env(headline = "HOLD — TEST"): BieAnswerEnvelope {
  return {
    version: 1,
    asOf: new Date().toISOString(),
    headline,
    bias: "bullish",
    sections: [{ title: "Verdict", body: "ok" }],
    evidence: [],
    markdown: "",
  };
}

function play(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "SWING:TEST",
    ticker: "TEST",
    direction: "LONG",
    contract: "100C · 13DTE",
    score: 70,
    status: "HOLD",
    horizon: "SWING",
    exitModel: "SCALE_OUT",
    recommendation: "HOLD",
    factors: [],
    gates: [],
    ...overrides,
  };
}

test("diffBriefSnapshots: first snapshot yields no changes", () => {
  const snap = snapshotFromBrief(env(), play());
  assert.deepEqual(diffBriefSnapshots(null, snap), []);
});

test("diffBriefSnapshots: detects thesis health and P&L moves", () => {
  const prev = snapshotFromBrief(env(), play({ thesisHealth: { health: 60, rungLabel: "ok", pillars: [], moves: [], advisory: "", entryIndex: 60, currentIndex: 60, delta: 0, rung: "OK", committedAtEt: "", computedAtEt: "" }, pnlPct: 20 }));
  const next = snapshotFromBrief(env(), play({ thesisHealth: { health: 54, rungLabel: "fade", pillars: [], moves: [], advisory: "", entryIndex: 60, currentIndex: 54, delta: -6, rung: "DEGRADED", committedAtEt: "", computedAtEt: "" }, pnlPct: 25 }));
  const lines = diffBriefSnapshots(prev, next);
  assert.ok(lines.some((l) => l.includes("Thesis")));
  assert.ok(lines.some((l) => l.includes("P&L")));
});

test("diffBriefSnapshots: omits thesis health delta when uncalibrated (extends #4318)", () => {
  const uncalibrated = {
    health: 46,
    rungLabel: "Degraded",
    pillars: [
      {
        id: "structure",
        label: "Persistence",
        weight: 0.28,
        commitScore: 0.4,
        currentScore: 0.35,
        commitLabel: "unknown",
        currentLabel: "unknown",
        status: "intact",
        contributionPts: 10,
        deltaPts: -1,
      },
      {
        id: "momentum",
        label: "Entry geometry",
        weight: 0.22,
        commitScore: 0.5,
        currentScore: 0.45,
        commitLabel: "n/a",
        currentLabel: "n/a",
        status: "intact",
        contributionPts: 10,
        deltaPts: -1,
      },
      {
        id: "flow",
        label: "Signal stack",
        weight: 0.2,
        commitScore: 0.35,
        currentScore: 0.35,
        commitLabel: "no signals",
        currentLabel: "no signals",
        status: "intact",
        contributionPts: 7,
        deltaPts: 0,
      },
    ],
    moves: [],
    advisory: "",
    entryIndex: 60,
    currentIndex: 46,
    delta: -14,
    rung: "DEGRADED",
    committedAtEt: "",
    computedAtEt: "",
  };
  const prev = snapshotFromBrief(env(), play({ thesisHealth: uncalibrated, pnlPct: 20 }));
  const next = snapshotFromBrief(
    env(),
    play({ thesisHealth: { ...uncalibrated, health: 52, currentIndex: 52, delta: -8 }, pnlPct: 25 }),
  );
  const lines = diffBriefSnapshots(prev, next);
  assert.ok(!lines.some((l) => l.includes("Thesis")), "uncalibrated rows must not narrate thesis % shifts");
  assert.ok(lines.some((l) => l.includes("P&L")), "P&L diff still fires on uncalibrated rows");
});

function thesisPayload(health: number, overrides: Record<string, unknown> = {}) {
  return {
    health,
    rungLabel: "ok",
    pillars: [],
    moves: [],
    advisory: "",
    entryIndex: 60,
    currentIndex: health,
    delta: health - 60,
    rung: "OK",
    committedAtEt: "",
    computedAtEt: "",
    ...overrides,
  };
}

test("diffBriefSnapshots: cross-field synthesis — thesis fade + FAVORABLE price move stay independent", () => {
  // Thesis fades AND spot moves, but UP (favorable for a LONG) — the two facts pull in
  // different directions, so this must read as two separate bullets, never a forced
  // "thesis fading AND price moved" causal line (see synthesizeThesisAndPrice's doc comment).
  const prev = snapshotFromBrief(
    env(),
    play({ direction: "LONG", thesisHealth: thesisPayload(60) as any }),
    { spot: 100, putWall: 95 },
  );
  const next = snapshotFromBrief(
    env(),
    play({ direction: "LONG", thesisHealth: thesisPayload(54, { rungLabel: "fade", rung: "DEGRADED" }) as any }),
    { spot: 103, putWall: 95 },
  );
  const lines = diffBriefSnapshots(prev, next);
  assert.ok(lines.some((l) => l.includes("Thesis fading")), `expected an independent thesis line, got: ${JSON.stringify(lines)}`);
  assert.ok(lines.some((l) => l.includes("Spot drifted higher")), `expected an independent spot line, got: ${JSON.stringify(lines)}`);
  assert.ok(
    !lines.some((l) => l.includes("Thesis fading") && l.includes("Spot drifted")),
    "a favorable price move must never be stitched to a fading thesis as one causal line",
  );
});

test("diffBriefSnapshots: cross-field synthesis — thesis fade + adverse price drift reads as one connected line naming the downgrade", () => {
  const prev = snapshotFromBrief(
    env(),
    play({ direction: "LONG", recommendation: "HOLD", thesisHealth: thesisPayload(60) as any }),
    { spot: 100, putWall: 95, gammaFlip: 99 },
  );
  const next = snapshotFromBrief(
    env(),
    play({ direction: "LONG", recommendation: "TRIM", thesisHealth: thesisPayload(54, { rungLabel: "fade", rung: "DEGRADED" }) as any }),
    { spot: 97, putWall: 95, gammaFlip: 99 },
  );
  const lines = diffBriefSnapshots(prev, next);
  const combined = lines.find((l) => l.includes("Thesis fading") && l.includes("put wall"));
  assert.ok(combined, `expected one connected thesis+price line, got: ${JSON.stringify(lines)}`);
  assert.match(combined!, /through the gamma flip toward/, "spot crossed the flip on the way to the wall — the connected line should say so");
  assert.match(combined!, /desk downgraded to \*\*TRIM\*\*/);
  assert.equal(
    lines.filter((l) => l.includes("Thesis")).length,
    1,
    "the thesis fact must not ALSO appear as its own separate bullet once synthesized",
  );
  assert.ok(
    !lines.some((l) => l.startsWith("**Desk action shifted**")),
    "the downgrade is folded into the connected line, not repeated as its own bullet",
  );
});

test("diffBriefSnapshots: cross-field synthesis — P&L building + desk upgrade reads as one connected line", () => {
  const prev = snapshotFromBrief(env(), play({ recommendation: "HOLD", pnlPct: 8 }));
  const next = snapshotFromBrief(env(), play({ recommendation: "BUY", pnlPct: 14 }));
  const lines = diffBriefSnapshots(prev, next);
  const combined = lines.find((l) => l.includes("P&L building") && l.includes("desk upgraded"));
  assert.ok(combined, `expected one connected P&L+upgrade line, got: ${JSON.stringify(lines)}`);
  assert.match(combined!, /\*\*HOLD\*\* → \*\*BUY\*\*/);
  assert.ok(
    !lines.some((l) => l.startsWith("**Desk action shifted**")),
    "the upgrade is folded into the connected line, not repeated as its own bullet",
  );
});

test("envelopeWithDiffSection: prepends change section", () => {
  const out = envelopeWithDiffSection(env(), ["Spot moved"]);
  assert.equal(out.sections[0]?.title, "What changed");
  assert.match(out.sections[0]?.body ?? "", /Spot moved/);
});

test("extrasFromBriefResponse: reads levels by label AND the explicit flowSnapshot field", () => {
  const response = {
    envelope: {
      ...env(),
      levels: [
        { label: "spot", price: 100.5, provenance: { source: "Vector", freshness: "live" as const } },
        { label: "call wall", price: 105, provenance: { source: "GEX", freshness: "recent" as const } },
        { label: "put wall", price: 95, provenance: { source: "GEX", freshness: "recent" as const } },
        { label: "gamma flip", price: 98, provenance: { source: "GEX", freshness: "recent" as const } },
      ],
    },
    flowSnapshot: { callPremium: 1_500_000, putPremium: 300_000 },
  };
  assert.deepEqual(extrasFromBriefResponse(response), {
    spot: 100.5,
    gammaFlip: 98,
    callWall: 105,
    putWall: 95,
    flowCallPremium: 1_500_000,
    flowPutPremium: 300_000,
    trimsFired: null,
  });
});

test("extrasFromBriefResponse: no flowSnapshot on the response is null, not a crash", () => {
  assert.deepEqual(extrasFromBriefResponse({ envelope: env() }), {
    spot: null,
    gammaFlip: null,
    callWall: null,
    putWall: null,
    flowCallPremium: null,
    flowPutPremium: null,
    trimsFired: null,
  });
});

test("diffBriefSnapshots: detects trim rail fires", () => {
  const prev = snapshotFromBrief(env(), play(), { trimsFired: 0 });
  const next = snapshotFromBrief(env(), play(), { trimsFired: 1 });
  const lines = diffBriefSnapshots(prev, next);
  assert.ok(lines.some((l) => l.includes("Trim rail")));
});

test("diffBriefSnapshots: option mark shift narrates built/slipped, not a bare delta", () => {
  const up = diffBriefSnapshots(
    snapshotFromBrief(env(), play({ mark: 5.9 })),
    snapshotFromBrief(env(), play({ mark: 6.18 })),
  );
  const upLine = up.find((l) => l.includes("Option mark"));
  assert.ok(upLine, `expected an option-mark line, got: ${JSON.stringify(up)}`);
  assert.match(upLine!, /\*\*Option mark built\*\*/);
  assert.match(upLine!, /\$5\.90 → \$6\.18/);

  const down = diffBriefSnapshots(
    snapshotFromBrief(env(), play({ mark: 6.18 })),
    snapshotFromBrief(env(), play({ mark: 5.9 })),
  );
  const downLine = down.find((l) => l.includes("Option mark"));
  assert.match(downLine!, /\*\*Option mark slipped\*\*/);
});

test("diffBriefSnapshots: a structural wall closing in on spot reads as compressing room, not a bare delta", () => {
  const prev = snapshotFromBrief(env(), play(), { spot: 100, callWall: 110 });
  const next = snapshotFromBrief(env(), play(), { spot: 100, callWall: 104 });
  const lines = diffBriefSnapshots(prev, next);
  const line = lines.find((l) => l.includes("Call wall"));
  assert.ok(line, `expected a call-wall line, got: ${JSON.stringify(lines)}`);
  assert.match(line!, /\*\*Call wall closing in\*\*/);
  assert.match(line!, /\$110\.00 → \$104\.00/);
  assert.match(line!, /now \$4\.00 away \(was \$10\.00\)/);
  assert.match(line!, /less room before it matters/);
});

test("diffBriefSnapshots: a structural wall receding from spot reads as more room, not a bare delta", () => {
  const prev = snapshotFromBrief(env(), play(), { spot: 100, putWall: 95 });
  const next = snapshotFromBrief(env(), play(), { spot: 100, putWall: 88 });
  const lines = diffBriefSnapshots(prev, next);
  const line = lines.find((l) => l.includes("Put wall"));
  assert.ok(line, `expected a put-wall line, got: ${JSON.stringify(lines)}`);
  assert.match(line!, /\*\*Put wall receding\*\*/);
  assert.match(line!, /now \$12\.00 away \(was \$5\.00\)/);
  assert.match(line!, /more room before it matters/);
});

test("diffBriefSnapshots: a wall move falls back to a plain delta when spot is unavailable", () => {
  const prev = snapshotFromBrief(env(), play(), { gammaFlip: 99 });
  const next = snapshotFromBrief(env(), play(), { gammaFlip: 101 });
  const lines = diffBriefSnapshots(prev, next);
  const line = lines.find((l) => l.includes("Gamma flip"));
  assert.ok(line, `expected a gamma-flip line, got: ${JSON.stringify(lines)}`);
  assert.equal(line, "Gamma flip moved 99 → 101 (+2.0)");
});

test("diffBriefSnapshots: a wall move falls back to a plain delta when the room-to-spot is actually unchanged", () => {
  // Spot and the wall both drift up by the same amount — the level moved, but the cushion to
  // spot never actually changed, so the room-framed read would be misleading; must fall back.
  const prev = snapshotFromBrief(env(), play(), { spot: 100, callWall: 110 });
  const next = snapshotFromBrief(env(), play(), { spot: 103, callWall: 113 });
  const lines = diffBriefSnapshots(prev, next);
  const line = lines.find((l) => l.includes("Call wall"));
  assert.ok(line, `expected a call-wall line, got: ${JSON.stringify(lines)}`);
  assert.equal(line, "Call wall moved 110 → 113 (+3.0)");
});

test("envelopeWithNarrativePulse: weaves pulse into Trade manager read", () => {
  const base = {
    ...env(),
    sections: [
      { title: "Trade manager read", body: "• Hold the line", bias: "neutral" as const },
      { title: "Verdict", body: "ok", bias: "neutral" as const },
    ],
  };
  const out = envelopeWithNarrativePulse(base, ["P&L +5% → +8%", "Spot moved"]);
  const narrative = out.sections.find((s) => s.title === "Trade manager read");
  assert.match(narrative!.body, /Since last read/i);
  assert.match(narrative!.body, /Hold the line/);
  assert.ok(!out.sections.some((s) => s.title === "What changed"));
});

test("envelopeWithNarrativePulse: overflow changes get What changed section", () => {
  const base = {
    ...env(),
    sections: [{ title: "Trade manager read", body: "• Hold", bias: "neutral" as const }],
  };
  const out = envelopeWithNarrativePulse(base, ["a", "b", "c", "d"]);
  assert.ok(out.sections.some((s) => s.title === "What changed"));
});

test("diffBriefSnapshots: detects HELIX call flow shift", () => {
  const baseEnvelope = env();
  const prevResponse = { envelope: baseEnvelope, flowSnapshot: { callPremium: 500_000, putPremium: 400_000 } };
  const nextResponse = { envelope: baseEnvelope, flowSnapshot: { callPremium: 900_000, putPremium: 380_000 } };
  const prevSnap = snapshotFromBrief(baseEnvelope, play(), extrasFromBriefResponse(prevResponse));
  const nextSnap = snapshotFromBrief(baseEnvelope, play(), extrasFromBriefResponse(nextResponse));
  const lines = diffBriefSnapshots(prevSnap, nextSnap);
  assert.ok(
    lines.some((l) => l.includes("HELIX tape: call flow building")),
    `expected call flow building line, got: ${JSON.stringify(lines)}`,
  );
});

test("diffBriefSnapshots: detects HELIX put-only flow build when call premium is flat", () => {
  const baseEnvelope = env();
  const prevResponse = { envelope: baseEnvelope, flowSnapshot: { callPremium: 500_000, putPremium: 400_000 } };
  const nextResponse = { envelope: baseEnvelope, flowSnapshot: { callPremium: 510_000, putPremium: 1_500_000 } };
  const prevSnap = snapshotFromBrief(baseEnvelope, play(), extrasFromBriefResponse(prevResponse));
  const nextSnap = snapshotFromBrief(baseEnvelope, play(), extrasFromBriefResponse(nextResponse));
  const lines = diffBriefSnapshots(prevSnap, nextSnap);
  assert.ok(
    lines.some((l) => l.includes("HELIX tape: put flow building")),
    `expected put flow building line, got: ${JSON.stringify(lines)}`,
  );
});

test("diffBriefSnapshots: narrates a WATCH-candidate direction flip (same play.id, reversed net flow)", () => {
  // Same ticker/play.id as a WATCH candidate would keep across discovery cycles (no positionId
  // suffix pre-commit) — only `direction` differs, exactly what a real net-flow reversal produces.
  const baseEnvelope = env();
  const prevSnap = snapshotFromBrief(baseEnvelope, play({ id: "SWING:NVDA", direction: "LONG" }));
  const nextSnap = snapshotFromBrief(baseEnvelope, play({ id: "SWING:NVDA", direction: "SHORT" }));
  const lines = diffBriefSnapshots(prevSnap, nextSnap);
  assert.ok(
    lines.some((l) => l.includes("Direction flipped") && l.includes("LONG") && l.includes("SHORT")),
    `expected a direction-flip line, got: ${JSON.stringify(lines)}`,
  );
});

test("diffBriefSnapshots: does not narrate a direction flip when direction is unchanged", () => {
  const baseEnvelope = env();
  const prevSnap = snapshotFromBrief(baseEnvelope, play({ direction: "LONG" }));
  const nextSnap = snapshotFromBrief(baseEnvelope, play({ direction: "LONG" }));
  const lines = diffBriefSnapshots(prevSnap, nextSnap);
  assert.ok(
    !lines.some((l) => l.includes("Direction flipped")),
    `expected no direction-flip line, got: ${JSON.stringify(lines)}`,
  );
});

test("diffBriefSnapshots: does not fabricate a flip when one side's direction is missing", () => {
  const baseEnvelope = env();
  const prevSnap = snapshotFromBrief(baseEnvelope, play({ direction: null as unknown as TerminalPlay["direction"] }));
  const nextSnap = snapshotFromBrief(baseEnvelope, play({ direction: "LONG" }));
  const lines = diffBriefSnapshots(prevSnap, nextSnap);
  assert.ok(
    !lines.some((l) => l.includes("Direction flipped")),
    `expected no direction-flip line when a side is null, got: ${JSON.stringify(lines)}`,
  );
});

test("briefContentKey: rounds raw floats — never leaks full-precision numbers past the route's own roundFloats pass", () => {
  // Real repro shape: AAPL closed-play pnlPct computed as mark/entry - 1, e.g. 4.5/10.275 - 1.
  const snap = snapshotFromBrief(env(), play({ pnlPct: -56.18644067796611 }));
  const key = briefContentKey(snap);
  assert.ok(!key.includes("56.18644067796611"), `raw unrounded float leaked into content key: ${key}`);
  const parsed = JSON.parse(key) as { pnlPct: number };
  assert.equal(parsed.pnlPct, -56.19, "pnlPct must be rounded to 2dp, same precision the route applies everywhere else");
});

test("briefSnapshotStorageKey: requires play id and session date", () => {
  assert.equal(briefSnapshotStorageKey("SWING:INTC:1", "2026-09-06"), "swing-brief-snap:SWING:INTC:1:2026-09-06");
  assert.equal(briefSnapshotStorageKey("", "2026-09-06"), null);
  assert.equal(briefSnapshotStorageKey("SWING:INTC:1", null), null);
});

test("loadPersistedBriefSnapshot: rejects a stored snapshot missing sectionTitles instead of returning it", () => {
  // Real failure mode: sessionStorage survives a deploy (it's per-tab/session, not per-release),
  // so a snapshot written by an older schema version (or corrupted by an extension/devtools edit)
  // can be missing a field the current diffBriefSnapshots unconditionally reads. The prior
  // validation only checked `headline` was a string and returned everything else as-is, so a
  // stored object like `{ headline: "x" }` (no sectionTitles) sailed through as a valid `prev`
  // snapshot, and diffBriefSnapshots's `next.sectionTitles.filter((t) => !prev.sectionTitles...)`
  // (play-brief-diff.ts) then threw `Cannot read properties of undefined (reading 'includes')`
  // inside useSwingPlayBrief's uncaught effect — crashing the whole play-brief render.
  const store = new Map<string, string>();
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
      },
    },
  });
  try {
    store.set("swing-brief-snap:SWING:TEST:1:2026-09-14", JSON.stringify({ headline: "old schema" }));
    const stored = loadPersistedBriefSnapshot("swing-brief-snap:SWING:TEST:1:2026-09-14");
    assert.equal(stored, null, "a malformed stored snapshot must be rejected, not handed back as a usable prev");

    // Confirm the crash this guards against, so the test can't pass on a coincidence: a stored
    // snapshot missing sectionTitles fed straight into diffBriefSnapshots as `prev` throws.
    const nextSnap = snapshotFromBrief(env(), play());
    assert.throws(() => diffBriefSnapshots({ headline: "old schema" } as never, nextSnap));
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});

test("loadPersistedBriefSnapshot: still accepts a well-formed stored snapshot", () => {
  const store = new Map<string, string>();
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
      },
    },
  });
  try {
    const snap = snapshotFromBrief(env(), play());
    store.set("swing-brief-snap:SWING:TEST:1:2026-09-14", JSON.stringify(snap));
    const stored = loadPersistedBriefSnapshot("swing-brief-snap:SWING:TEST:1:2026-09-14");
    assert.deepEqual(stored, snap);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});
