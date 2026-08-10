import { test } from "node:test";
import assert from "node:assert/strict";
import { LARGO_BLOCK_TYPES, parseLargoBlock, parseLargoBlockPayload } from "./schema";
import { extractLargoSegments, hasLargoBlocks, stripLargoBlocks } from "./extract";

/** The worked example from the brief, in wire form. */
const RICH = `**Verdict** — SPX bullish above 7,460.

\`\`\`blackout
{
  "type": "header",
  "title": "SPX — BULLISH",
  "tone": "bullish",
  "confidence": { "level": "high", "pct": 82, "why": "four of four desks aligned" }
}
\`\`\`

\`\`\`blackout
{
  "type": "comparison",
  "title": "Signal alignment",
  "rows": [
    { "label": "Helix Flow", "reading": "$18.4M net calls", "tone": "bullish" },
    { "label": "Thermal GEX", "reading": "-$2.1B", "tone": "warning" },
    { "label": "SPX Slayer", "reading": "Above VWAP", "tone": "bullish" },
    { "label": "Night Hawk", "reading": "2 LONG / 0 SHORT", "tone": "bullish" }
  ]
}
\`\`\`

Some prose between components.

\`\`\`blackout
{
  "type": "levels",
  "spot": 7472,
  "items": [
    { "label": "Call Wall", "price": 7500, "kind": "resistance" },
    { "label": "Support", "price": 7460, "kind": "support" },
    { "label": "VWAP", "price": 7438, "kind": "pivot" }
  ]
}
\`\`\`

**Bottom line** — buyers in control above 7,460.`;

test("extracts every component and preserves the prose around them", () => {
  const segs = extractLargoSegments(RICH);
  assert.deepEqual(
    segs.map((s) => (s.kind === "block" ? s.block.type : s.kind)),
    ["prose", "header", "comparison", "prose", "levels", "prose"]
  );
});

test("a simple answer with no fences yields exactly one prose segment", () => {
  // The "simple question gets a simple answer" guarantee: the rich path must cost nothing when
  // it is not used.
  const segs = extractLargoSegments("**Verdict** — SPX 7757.64, flat.\n\n**Data** — live.");
  assert.equal(segs.length, 1);
  assert.equal(segs[0]!.kind, "prose");
  assert.equal(hasLargoBlocks("**Verdict** — SPX 7757.64"), false);
});

test("an unterminated fence renders PENDING, never raw JSON", () => {
  // This is the mid-stream state on literally every token while a block is being written. Leaking
  // the payload would splatter JSON across the terminal for seconds.
  const partial = 'Reading the tape.\n\n```blackout\n{ "type": "comparison", "rows": [ { "label": "Heli';
  const segs = extractLargoSegments(partial);
  assert.deepEqual(segs.map((s) => s.kind), ["prose", "pending"]);
  assert.doesNotMatch(JSON.stringify(segs), /Heli/, "partial payload must not leak into a segment");
});

test("malformed JSON drops the component and keeps the surrounding answer", () => {
  const md = "Before.\n\n```blackout\n{ this is not json ]\n```\n\nAfter.";
  const segs = extractLargoSegments(md);
  assert.deepEqual(segs.map((s) => s.kind), ["prose", "prose"]);
  assert.equal((segs[0] as { text: string }).text.trim(), "Before.");
  assert.equal((segs[1] as { text: string }).text.trim(), "After.");
});

test("a fence may carry an array of components", () => {
  const md = '```blackout\n[{"type":"callout","body":"A"},{"type":"callout","body":"B"}]\n```';
  const segs = extractLargoSegments(md);
  assert.equal(segs.filter((s) => s.kind === "block").length, 2);
});

test("stripLargoBlocks removes payloads so the verifier cannot double-count numbers", () => {
  // The verifier traces every number in the answer back to the turn's tool results. Leaving the
  // JSON in would count 7500/7460/7438 twice and skew the coverage ratio that decides whether the
  // member sees the low-confidence caveat.
  const stripped = stripLargoBlocks(RICH);
  assert.doesNotMatch(stripped, /"type"/);
  assert.doesNotMatch(stripped, /7500/);
  assert.match(stripped, /Verdict/);
  assert.match(stripped, /Bottom line/);
  assert.match(stripped, /Some prose between components/);
});

// ── schema validation ────────────────────────────────────────────────────────────────────────

test("structurally empty components are REJECTED, not rendered as empty shells", () => {
  // An empty component under a confident title reads as "there is no data" when the truth is
  // "the model emitted a malformed block" — and a member cannot tell those apart.
  assert.equal(parseLargoBlock({ type: "table", title: "Levels", columns: ["A"], rows: [] }), null);
  assert.equal(parseLargoBlock({ type: "table", title: "Levels", columns: [], rows: [["x"]] }), null);
  assert.equal(parseLargoBlock({ type: "comparison", title: "Signals", rows: [] }), null);
  assert.equal(parseLargoBlock({ type: "metrics", items: [] }), null);
  assert.equal(parseLargoBlock({ type: "evidence", bull: [], bear: [] }), null);
  assert.equal(parseLargoBlock({ type: "risk", items: [] }), null);
});

test("a one-sided evidence block is legitimate — a one-way tape has no other column", () => {
  const b = parseLargoBlock({ type: "evidence", bull: ["Calls dominating 7:1"], bear: [] });
  assert.equal(b?.type, "evidence");
});

test("ragged table rows are padded to the header width, never left to shift columns", () => {
  const b = parseLargoBlock({
    type: "table",
    columns: ["Ticker", "Strike", "Mark"],
    rows: [["NVDA", "230"], ["AMD", "170", "2.15", "EXTRA"]],
  });
  assert.equal(b?.type, "table");
  if (b?.type !== "table") return;
  for (const row of b.rows) assert.equal(row.length, 3, "every row must match the header width");
  assert.deepEqual(b.rows[0], ["NVDA", "230", ""]);
  assert.deepEqual(b.rows[1], ["AMD", "170", "2.15"]);
});

test("unknown block types are dropped silently, not rendered as raw JSON", () => {
  // A block type shipped by the prompt before the renderer knows it should be invisible, not ugly.
  assert.equal(parseLargoBlock({ type: "hologram", title: "x" }), null);
  assert.deepEqual(parseLargoBlockPayload('{"type":"hologram"}'), []);
});

test("unknown FIELDS are ignored so the model cannot break rendering by adding one", () => {
  const b = parseLargoBlock({ type: "callout", body: "Watch 7460", tone: "bullish", sparkle: true, v: 9 });
  assert.deepEqual(b, { type: "callout", title: undefined, body: "Watch 7460", tone: "bullish" });
});

test("invalid tones and freshness degrade to undefined rather than reaching the DOM", () => {
  const b = parseLargoBlock({ type: "callout", body: "x", tone: "radioactive" });
  assert.equal(b?.type === "callout" ? b.tone : "set", undefined);
});

test("contracts accept CALL/PUT as well as C/P and reject a contract missing its strike", () => {
  const ok = parseLargoBlock({
    type: "contracts",
    items: [
      { ticker: "nvda", right: "call", strike: "230", expiry: "2026-08-21", mark: "4.10" },
      { ticker: "AMD", right: "P", strike: 170, expiry: "2026-08-21" },
      { ticker: "META", right: "C", expiry: "2026-08-21" },
    ],
  });
  assert.equal(ok?.type, "contracts");
  if (ok?.type !== "contracts") return;
  assert.equal(ok.items.length, 2, "the strike-less contract must be dropped");
  assert.equal(ok.items[0]!.ticker, "NVDA");
  assert.equal(ok.items[0]!.right, "C");
  assert.equal(ok.items[0]!.strike, 230);
});

test("comparison accepts the model's likely aliases (signal/value/bias)", () => {
  // The prompt says label/reading/tone, but a model will reach for the words in the question.
  // Accepting the obvious synonyms costs nothing and saves a dropped component.
  const b = parseLargoBlock({
    type: "comparison",
    rows: [{ signal: "Helix Flow", value: "$18.4M net calls", bias: "bullish" }],
  });
  assert.equal(b?.type, "comparison");
  if (b?.type !== "comparison") return;
  assert.deepEqual(b.rows[0], { label: "Helix Flow", reading: "$18.4M net calls", tone: "bullish", note: undefined, source: undefined });
});

test("numbers arrive as strings or numbers — both parse, junk does not", () => {
  const b = parseLargoBlock({ type: "levels", spot: "7,472", items: [{ label: "Wall", price: "7,500" }] });
  assert.equal(b?.type === "levels" ? b.spot : null, 7472);
  assert.equal(b?.type === "levels" ? b.items[0]!.price : null, 7500);
  assert.equal(parseLargoBlock({ type: "levels", items: [{ label: "Wall", price: "n/a" }] }), null);
});

test("parsing never throws on adversarial payloads", () => {
  for (const bad of [null, undefined, 42, "str", [], {}, { type: 123 }, { type: "table", columns: "no" }]) {
    assert.doesNotThrow(() => parseLargoBlock(bad));
  }
  for (const bad of ["", "null", "[", '{"type":', "[1,2,3]", '"just a string"']) {
    assert.doesNotThrow(() => parseLargoBlockPayload(bad));
  }
  assert.doesNotThrow(() => extractLargoSegments("```blackout\n".repeat(200)));
});

test("every declared block type is actually constructible", () => {
  // Guards the list against drift: a type named in LARGO_BLOCK_TYPES that the parser rejects would
  // be advertised to the model in the prompt and then silently dropped at render.
  const samples: Record<string, unknown> = {
    header: { type: "header", title: "T" },
    metrics: { type: "metrics", items: [{ label: "L", value: "V" }] },
    comparison: { type: "comparison", rows: [{ label: "L", reading: "R" }] },
    table: { type: "table", columns: ["A"], rows: [["1"]] },
    ranked: { type: "ranked", items: [{ label: "L" }] },
    levels: { type: "levels", items: [{ label: "L", price: 1 }] },
    evidence: { type: "evidence", bull: ["b"], bear: [] },
    timeline: { type: "timeline", items: [{ at: "09:30", label: "Open" }] },
    contracts: { type: "contracts", items: [{ ticker: "X", right: "C", strike: 1, expiry: "2026-01-01" }] },
    pnl: { type: "pnl", items: [{ label: "L", pnl: "+$1" }] },
    callout: { type: "callout", body: "b" },
    risk: { type: "risk", items: ["r"] },
  };
  for (const t of LARGO_BLOCK_TYPES) {
    const parsed = parseLargoBlock(samples[t]);
    assert.equal(parsed?.type, t, `${t} must round-trip through the parser`);
  }
});
