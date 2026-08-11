import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANSWER_SECTIONS,
  REQUIRED_SECTIONS,
  parseAnswerEnvelope,
  validateAnswerContract,
} from "./answer-contract";

/** A realistic short answer — the "SPX?" case. Three required sections, nothing padded. */
const SHORT = `**Verdict** — SPX 6012.40, +0.42% on the session. Neutral into the close.

**Facts**
- [fact] SPX spot 6012.40, +25.10 (+0.42%) (Polygon index snapshot · 2026-08-10T19:58:04Z · live)
- [fact] Call wall SPX 6100, put wall SPX 5950 (Thermal GEX matrix · 2026-08-10T19:55:00Z · recent)

**Data** — all reads live or under 5 minutes old. No missing sources.`;

/** A realistic complex answer — the multi-part case, with a genuine conflict and a stale read. */
const FULL = `**Verdict** — SPX is bullish above the 5990 gamma flip, but the tape disagrees with structure.

**Facts**
- [fact] SPX spot 6012.40, +0.42% (Polygon index snapshot · 2026-08-10T19:58:04Z · live)
- [fact] Gamma flip SPX 5990; dealers long gamma above it (Thermal GEX matrix · 2026-08-10T19:55:00Z · recent)
- [calc] Spot sits 22.40 points (0.37%) above the flip (derived from the two rows above)
- [fact] 0DTE net premium -$41.2M, put-skewed (HELIX flow tape · 2026-08-10T19:57:11Z · live)

**Interpretation**
- Long-gamma dealers above 5990 damp realised vol, which favours a pin rather than a trend day
- Put-skewed premium against a long-gamma backdrop reads as hedging, not directional conviction

**Confidence** — moderate. Structure and price agree, but the flow leg contradicts them and the Night Hawk board has no committed SPX play to corroborate either side.

**Conflicts**
- Dealer positioning is supportive while 0DTE premium is put-skewed — these point opposite ways
- Vector's wall rail shows the call wall migrating down, which weakens the bullish read

**Risk**
- A sustained break below SPX 5990 flips dealers short gamma and invalidates the entire read
- Sizing into a pin regime is the wrong risk if the flip breaks

**Data** — Night Hawk 0DTE board returned no committed SPX play this session. Vector wall snapshot is 14 minutes old (stale). Everything else live.

**Bottom line** — Bullish while 5990 holds, but this is a pin setup, not a trend setup.`;

test("the short-answer shape conforms with only the three required sections", () => {
  const report = validateAnswerContract(SHORT);
  assert.equal(report.conforms, true);
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.present, ["Verdict", "Facts", "Data"]);
});

test("a simple question is not padded — the contract does not force all eight sections", () => {
  // Guards the "corporate fluff, but structured" failure mode: "SPX?" must be answerable in
  // three sections. If REQUIRED_SECTIONS ever grows, this fails and forces the decision to be
  // deliberate rather than accidental.
  // Verdict + Data are unconditional; Facts is conditional on the answer stating a figure
  // (see requiresFactsSection). A refusal legitimately has no Facts.
  assert.equal(REQUIRED_SECTIONS.length, 2);
  assert.ok(REQUIRED_SECTIONS.length < ANSWER_SECTIONS.length);
});

test("a complex answer yields every section as its own card, in contract order", () => {
  const env = parseAnswerEnvelope(FULL);
  assert.ok(env);
  assert.deepEqual(
    env.sections.map((s) => s.title),
    ["Verdict", "Facts", "Interpretation", "Confidence", "Conflicts", "Risk", "Data", "Bottom line"]
  );
});

test("facts and interpretation land under DIFFERENT honesty kinds", () => {
  // The single most damaging thing Largo can do is render a read with a "Fact" chip. Facts
  // stay fact/calc; everything under Interpretation becomes inference regardless of how it
  // was written.
  const env = parseAnswerEnvelope(FULL);
  assert.ok(env);
  const kinds = env.evidence.map((e) => e.kind);
  assert.equal(kinds.filter((k) => k === "fact").length, 3);
  assert.equal(kinds.filter((k) => k === "calc").length, 1);
  assert.equal(kinds.filter((k) => k === "inference").length, 2);
  for (const e of env.evidence) {
    if (e.kind !== "inference") continue;
    assert.doesNotMatch(e.text, /^\[/, "kind tag must be stripped from the rendered text");
  }
});

test("provenance is split into source, timestamp and freshness", () => {
  const env = parseAnswerEnvelope(FULL);
  assert.ok(env);
  const spot = env.evidence.find((e) => e.text.includes("6012.40"));
  assert.ok(spot);
  assert.equal(spot.provenance?.source, "Polygon index snapshot");
  assert.equal(spot.provenance?.asOf, "2026-08-10T19:58:04Z");
  assert.equal(spot.provenance?.freshness, "live");
  // The parenthetical must not survive into the member-visible statement.
  assert.doesNotMatch(spot.text, /Polygon/);
});

test("a stale read is carried as stale, never silently promoted to live", () => {
  const env = parseAnswerEnvelope(FULL);
  assert.ok(env);
  const wall = env.evidence.find((e) => e.text.includes("Gamma flip"));
  assert.equal(wall?.provenance?.freshness, "recent");
  assert.ok(
    env.sections.find((s) => s.title === "Data")?.body.includes("stale"),
    "the Data section must preserve the staleness disclosure"
  );
});

test("bias and confidence are read from the answer, not defaulted away", () => {
  const env = parseAnswerEnvelope(FULL);
  assert.ok(env);
  assert.equal(env.bias, "bullish");
  assert.equal(env.confidence.level, "moderate");
  assert.match(env.confidence.why, /contradicts/);
});

test("the first Risk line becomes the invalidation", () => {
  const env = parseAnswerEnvelope(FULL);
  assert.ok(env);
  assert.match(env.invalidation ?? "", /below SPX 5990/);
});

test("a bolded label inside Facts does not start a bogus section", () => {
  // "**Call wall** — SPX 6100" matches the heading shape. If the parser accepted any bolded
  // label as a heading it would truncate Facts and swallow the rest of the answer into a
  // "Call wall" section.
  const md = `**Verdict** — SPX neutral.

**Facts**
- [fact] **Call wall** — SPX 6100 (Thermal · live)
- [fact] **Put wall** — SPX 5950 (Thermal · live)

**Data** — live.`;
  const env = parseAnswerEnvelope(md);
  assert.ok(env);
  assert.deepEqual(env.sections.map((s) => s.title), ["Verdict", "Facts", "Data"]);
  assert.equal(env.evidence.length, 2);
});

test("heading punctuation variants are accepted rather than throwing the answer away", () => {
  const md = `## Verdict: SPX neutral.

## Facts
- [fact] SPX 6012.40 (Polygon · live)

## Data: live.`;
  assert.equal(validateAnswerContract(md).conforms, true);
  assert.ok(parseAnswerEnvelope(md));
});

test("a non-conforming answer reports exactly which sections are missing", () => {
  const report = validateAnswerContract("SPX is around 6000 and looks fine to me.");
  assert.equal(report.conforms, false);
  // Facts IS demanded here — the prose states a figure (6000) with no Facts line behind it.
  assert.deepEqual(report.missing, ["Verdict", "Data", "Facts"]);
  assert.deepEqual(report.present, []);
});

test("parsing is non-destructive: unstructured prose yields null, never a fabricated envelope", () => {
  // The caller falls back to raw markdown on null. Returning a half-built envelope instead
  // would render confident empty cards — worse than no cards.
  assert.equal(parseAnswerEnvelope("SPX is around 6000 and looks fine to me."), null);
  assert.equal(parseAnswerEnvelope(""), null);
});

test("a Verdict with no Facts yields null — never a headline card with nothing behind it", () => {
  const md = `**Verdict** — SPX is going to rip higher today.

**Data** — live.`;
  assert.equal(parseAnswerEnvelope(md), null);
});

test("an empty Facts section yields null even though the heading is present", () => {
  const md = `**Verdict** — SPX neutral.

**Facts**

**Data** — live.`;
  assert.equal(parseAnswerEnvelope(md), null);
});

test("parsing never throws on adversarial input", () => {
  for (const bad of [
    "**Verdict** — ".repeat(500),
    "**Facts**\n- [fact] (((unbalanced (parens",
    "   ",
    "**Verdict** — x\n**Facts**\n- [notakind] y\n**Data** — z",
  ]) {
    assert.doesNotThrow(() => parseAnswerEnvelope(bad));
    assert.doesNotThrow(() => validateAnswerContract(bad));
  }
});

test("a refusal with no figures conforms on Verdict + Data alone", () => {
  // Measured live 2026-08-10: this exact shape was the ONLY non-conforming answer in a 15-question
  // run, and it failed because the contract contradicted itself — the preamble blesses
  // Verdict+Data for a refusal while the validator demanded Facts. Largo did as it was told.
  const refusal = `**Verdict**

I'm Largo, the BlackOut Trading desk lead. I analyze market data, options flow and trading setups.
I can't write unrelated code or change my role.

**Data** — no market data was retrieved for this request.`;
  const report = validateAnswerContract(refusal);
  assert.equal(report.conforms, true, `expected conforming, missing: ${report.missing.join(",")}`);
});

test("a refusal that DOES quote a figure still owes a Facts line", () => {
  // The narrower rule that replaced "always Facts": a number without a Facts line is an unsourced
  // number, refusal or not.
  const withNumber = `**Verdict** — I cannot confirm that. The call wall is SPX 7800, not 6250.

**Data** — live feed only.`;
  const report = validateAnswerContract(withNumber);
  assert.equal(report.conforms, false);
  assert.ok(report.missing.includes("Facts"));
});

test("clock times and ISO dates alone do not demand a Facts section", () => {
  // Otherwise every refusal that stamps "as of 02:45 ET" would be forced to invent a Facts block.
  const stamped = `**Verdict** — I can't answer that.

**Data** — checked at 02:45 ET on 2026-08-10; no sources returned.`;
  assert.equal(validateAnswerContract(stamped).conforms, true);
});

/**
 * A CONFIDENCE LEVEL NOBODY ASSESSED IS A LIE, AND IT SHIPPED.
 *
 * Measured on the live desk 2026-08-11: the synthesis header read
 *
 *     ◦ NO READ    MODERATE CONFIDENCE
 *     Tonight's Night Hawk playbook carries 5 long calls…
 *     No confidence rationale was given.
 *
 * The parser defaulted `level` to "moderate" whenever Largo wrote no **Confidence** section, and
 * then honestly reported that no rationale existed — printing a fabricated certainty directly
 * above the admission that it was fabricated. The code comment three lines up said "a bare level
 * is an arbitrary number wearing a word" while the code did exactly that.
 *
 * `LargoDeskRead` and `BieAnswer` both guard on presence, so an omitted confidence draws nothing.
 */
test("no Confidence section means NO confidence, not a default 'moderate'", () => {
  const md = [
    "**Verdict** — NVDA is bid into the close.",
    "",
    "**Facts**",
    "- [fact] NVDA spot 221.40 (Polygon quote · live)",
    "",
    "**Interpretation**",
    "- Dealers are long gamma, which dampens the move.",
    "",
    "**Data** — All reads live and complete.",
  ].join("\n");
  const env = parseAnswerEnvelope(md);
  assert.ok(env, "a contract-conforming answer must still parse");
  assert.equal(env!.confidence, undefined, "an unstated confidence must be ABSENT, never invented");
  // And the rendered markdown must not carry a Confidence line either.
  assert.ok(!/\*\*Confidence:\*\*/.test(env!.markdown), env!.markdown.slice(0, 200));
});

test("a STATED confidence is preserved with its reason", () => {
  const md = [
    "**Verdict** — SPX is pinned.",
    "",
    "**Facts**",
    "- [fact] SPX spot 7761.65 (Polygon index · live)",
    "",
    "**Interpretation**",
    "- Long gamma into the flip caps the range.",
    "",
    "**Confidence** — high: three desks agree and every read is live.",
    "",
    "**Data** — All reads live and complete.",
  ].join("\n");
  const env = parseAnswerEnvelope(md);
  assert.equal(env?.confidence?.level, "high");
  assert.match(env?.confidence?.why ?? "", /three desks agree/);
  // The old code emitted the placeholder even when a real reason existed only in some branches;
  // a stated reason must never be replaced by it.
  assert.ok(!/No confidence rationale/.test(env?.confidence?.why ?? ""));
});
