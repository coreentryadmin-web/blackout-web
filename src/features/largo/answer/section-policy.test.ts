import test from "node:test";
import assert from "node:assert/strict";
import { proseSections, summariseEvidence, hasExpandableEvidence } from "./section-policy";
import type { BieEvidence, BieSection } from "@/lib/bie/answer-envelope";

/** Every canonical contract section, as the envelope actually delivers them. */
const ALL_SECTIONS: BieSection[] = [
  { title: "Verdict", body: "Mixed — flow is bullish but structure is bearish." },
  { title: "Facts", body: "- [fact] SPX spot 7752.65 (Polygon · live)" },
  { title: "Interpretation", body: "Bullish flow is fighting bearish price structure." },
  { title: "Confidence", body: "Moderate — five signals conflict." },
  { title: "Conflicts", body: "HELIX says bullish; VECTOR says bearish." },
  { title: "Risk", body: "Invalid below 7750." },
  { title: "Data", body: "All sources live within 5s." },
  { title: "Bottom line", body: "Mixed. Wait for structure to resolve." },
];

test("only the sections that exist nowhere else become prose cards", () => {
  assert.deepEqual(
    proseSections(ALL_SECTIONS).map((s) => s.title),
    ["Interpretation", "Conflicts"]
  );
});

test("the Facts card is dropped, which is what leaked the [fact] markers", () => {
  // parseEvidence strips the marker; the RAW section body does not, and it was rendered too.
  const kept = proseSections(ALL_SECTIONS);
  assert.equal(kept.some((s) => /\[fact\]/.test(s.body)), false);
});

test("Confidence is dropped because confidence.why is the identical string", () => {
  assert.equal(proseSections(ALL_SECTIONS).some((s) => s.title === "Confidence"), false);
});

test("an unknown section is KEPT — the filter names duplicates, not an allowlist", () => {
  const withNew: BieSection[] = [...ALL_SECTIONS, { title: "Positioning", body: "Dealers are short gamma." }];
  assert.equal(proseSections(withNew).some((s) => s.title === "Positioning"), true);
});

test("empty and malformed sections never render an empty card", () => {
  const messy: BieSection[] = [
    { title: "Interpretation", body: "   " },
    { title: "", body: "orphaned" },
    { title: "Conflicts", body: "real" },
  ];
  assert.deepEqual(proseSections(messy).map((s) => s.title), ["Conflicts"]);
  assert.deepEqual(proseSections(undefined), []);
});

test("section titles match case-insensitively", () => {
  const shouty: BieSection[] = [
    { title: "VERDICT", body: "x" },
    { title: "bottom line", body: "y" },
    { title: "Interpretation", body: "z" },
  ];
  assert.deepEqual(proseSections(shouty).map((s) => s.title), ["Interpretation"]);
});

const EVIDENCE: BieEvidence[] = [
  { kind: "fact", text: "a", provenance: { source: "HELIX", asOf: null, freshness: "live" } },
  { kind: "fact", text: "b", provenance: { source: "HELIX", asOf: null, freshness: "stale" } },
  { kind: "calc", text: "c", provenance: { source: "VECTOR", asOf: null, freshness: "live" } },
  { kind: "inference", text: "d", provenance: { source: "VECTOR", asOf: null, freshness: "live" } },
  { kind: "scenario", text: "e" },
];

test("evidence summary counts DISTINCT sources, not rows", () => {
  const s = summariseEvidence(EVIDENCE);
  // Two HELIX rows are one source; reporting 5 would inflate the answer's apparent breadth.
  assert.equal(s.sources, 2);
  assert.equal(s.facts, 3); // fact + fact + calc are both measurement
  assert.equal(s.inferences, 2); // inference + scenario are both reasoning
  assert.equal(s.label, "3 facts · 2 inferences · 2 sources");
});

test("a source is live if ANY of its rows is live", () => {
  assert.equal(summariseEvidence(EVIDENCE).liveSources, 2);
});

test("singulars are singular and an empty answer has an empty label", () => {
  const one = summariseEvidence([{ kind: "fact", text: "a", provenance: { source: "X", asOf: null } }]);
  assert.equal(one.label, "1 fact · 1 source");
  assert.equal(summariseEvidence([]).label, "");
  assert.equal(summariseEvidence(undefined).sources, 0);
});

test("a one-row answer does not get a disclosure control", () => {
  // The control would cost more attention than the content behind it.
  assert.equal(hasExpandableEvidence({ evidence: [EVIDENCE[0]!] }), false);
  assert.equal(hasExpandableEvidence({ evidence: EVIDENCE }), true);
  assert.equal(hasExpandableEvidence({ evidence: [] }), false);
});
