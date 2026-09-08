import test from "node:test";
import assert from "node:assert/strict";
import { validatePrint, validateFlowTape, intrinsicPerContract } from "./flow-validation";

const NOW = Date.parse("2026-08-10T14:00:00.000Z");
const SPOT = 7760.59;

/** The exact live print that started this: SPX 200 call, $753,145, expiry 2026-12-18. */
const SPX_200_CALL = {
  ticker: "SPX",
  strike: 200,
  premium: 753145,
  option_type: "CALL",
  expiry: "2026-12-18",
  alerted_at: "2026-08-10T13:59:33.847Z",
};

/** An ordinary near-the-money directional bet. */
const SPX_7800_CALL = {
  ticker: "SPX",
  strike: 7800,
  premium: 250000,
  option_type: "CALL",
  expiry: "2026-08-14",
  alerted_at: "2026-08-10T13:59:00.000Z",
};

test("intrinsic arithmetic is the discriminator", () => {
  // (7760.59 - 200) * 100 = 756,059 — and the live premium was 753,145, a ratio of 0.9961.
  assert.equal(Math.round(intrinsicPerContract(SPOT, 200, "CALL")!), 756059);
  assert.equal(intrinsicPerContract(SPOT, 7800, "CALL"), 0); // OTM call has no intrinsic
  assert.equal(intrinsicPerContract(null, 200, "CALL"), null);
  assert.equal(intrinsicPerContract(SPOT, 200, "junk"), null);
});

test("the SPX 200 print is REAL, not malformed — and is not a directional vote", () => {
  const v = validatePrint(SPX_200_CALL, SPOT, NOW);
  // It survives, and stays on the tape: nothing here proves it is bad data.
  assert.equal(v.usable, true);
  // But it does not vote.
  assert.equal(v.directional, false);
  assert.equal(v.issues.some((i) => i.code === "premium_is_intrinsic"), true);
});

test("a far strike is surfaced for verification, never asserted malformed", () => {
  // The SPX 200 print is 97% from spot AND deep ITM: flagged for a human look, but kept, because
  // the data cannot tell "real LEAPS" from "bad contract" and claiming either would be a guess.
  const v = validatePrint(SPX_200_CALL, SPOT, NOW);
  const flag = v.issues.find((i) => i.code === "strike_implausible")!;
  assert.match(flag.message, /verify contract symbol, underlying and strike multiplier/);
  assert.equal(flag.severity, "note");
  assert.equal(v.usable, true);
});

test("a far strike that is NOT deep ITM is excluded outright", () => {
  // A far OTM strike has no intrinsic to justify its distance — nothing corroborates it at all.
  const farOtm = { ...SPX_200_CALL, strike: 20000, premium: 4200 };
  const v = validatePrint(farOtm, SPOT, NOW);
  assert.equal(v.usable, false);
  assert.equal(v.issues.find((i) => i.code === "strike_implausible")!.severity, "exclude");
});

test("an ordinary near-the-money print is untouched", () => {
  const v = validatePrint(SPX_7800_CALL, SPOT, NOW);
  assert.equal(v.usable, true);
  assert.equal(v.directional, true);
  assert.equal(v.issues.filter((i) => i.severity !== "note").length, 0);
});

test("deep-ITM detection is by moneyness, so premium size cannot defeat it", () => {
  // The live tape carried $1,506,410 (two contracts) and $753,145 (one) at the same strike. Both
  // are positions, not views; the old premium-arithmetic test let large sizes slip through.
  assert.equal(validatePrint({ ...SPX_200_CALL, premium: 1506410 }, SPOT, NOW).directional, false);
  assert.equal(validatePrint({ ...SPX_200_CALL, premium: 753145 }, SPOT, NOW).directional, false);
  // An ordinary 3%-ITM call still votes — the threshold sits above normal directional trades.
  const shallowItm = { ...SPX_7800_CALL, strike: 7550, premium: 250000 };
  assert.equal(validatePrint(shallowItm, SPOT, NOW).directional, true);
});

test("missing spot skips moneyness checks rather than guessing", () => {
  const v = validatePrint(SPX_200_CALL, null, NOW);
  assert.equal(v.usable, true);
  assert.equal(v.directional, true); // no reference price = no verdict, not a rejection
});

test("expired and malformed rows are excluded; a missing expiry is only a note", () => {
  assert.equal(validatePrint({ ...SPX_7800_CALL, expiry: "2026-08-01" }, SPOT, NOW).usable, false);
  assert.equal(validatePrint({ ...SPX_7800_CALL, strike: null }, SPOT, NOW).usable, false);
  assert.equal(validatePrint({ ...SPX_7800_CALL, premium: 0 }, SPOT, NOW).usable, false);
  const noExpiry = validatePrint({ ...SPX_7800_CALL, expiry: null }, SPOT, NOW);
  assert.equal(noExpiry.usable, true);
  assert.equal(noExpiry.issues.some((i) => i.code === "expiry_missing"), true);
});

test("a future-dated alerted_at is flagged as untrustworthy, not silently read as fresh", () => {
  // A negative `nowMs - t` (alerted_at ahead of NOW — clock skew or a mis-stamped print) used to
  // never exceed the positive STALE_PRINT_MS threshold, so the print silently carried NO timing
  // note at all — read as fresher than a genuinely current print rather than flagged.
  const futureDated = { ...SPX_7800_CALL, alerted_at: new Date(NOW + 5 * 60_000).toISOString() };
  const v = validatePrint(futureDated, SPOT, NOW);
  assert.equal(v.usable, true, "a future-dated timestamp is a note, not an exclusion");
  const flag = v.issues.find((i) => i.code === "future_dated");
  assert.ok(flag, "must be flagged, not silently passed");
  assert.equal(flag!.severity, "note");
});

test("an unparseable alerted_at is silently skipped, not misread as future-dated", () => {
  const garbled = { ...SPX_7800_CALL, alerted_at: "not-a-real-timestamp" };
  const v = validatePrint(garbled, SPOT, NOW);
  assert.equal(v.issues.some((i) => i.code === "future_dated" || i.code === "stale"), false);
});

test("the sign inversion is detected and BOTH nets are reported", () => {
  // Reproduces the measured shape: a few huge deep-ITM calls outweighing genuinely bearish flow.
  const tape = [
    SPX_200_CALL,
    { ...SPX_200_CALL, premium: 1506410 },
    { ...SPX_7800_CALL, option_type: "PUT", strike: 7700, premium: 900000 },
    { ...SPX_7800_CALL, option_type: "PUT", strike: 7750, premium: 800000 },
    { ...SPX_7800_CALL, premium: 400000 },
  ];
  const { summary } = validateFlowTape(tape, SPOT, NOW);

  assert.equal(summary.total, 5);
  assert.equal(summary.usable, 5); // nothing is thrown away
  assert.equal(summary.directional, 3); // the two deep-ITM prints do not vote

  // Unfiltered reads bullish; the honest directional read is bearish.
  assert.ok(summary.netPremiumUnfiltered! > 0);
  assert.ok(summary.netPremium! < 0);
  assert.equal(summary.signInverted, true);

  // And the removal is never silent.
  const ex = summary.exclusions.find((e) => e.code === "premium_is_intrinsic")!;
  assert.equal(ex.count, 2);
});

test("a clean tape reports no inversion and no exclusions", () => {
  const { summary } = validateFlowTape([SPX_7800_CALL, { ...SPX_7800_CALL, premium: 100000 }], SPOT, NOW);
  assert.equal(summary.signInverted, false);
  assert.equal(summary.exclusions.length, 0);
  assert.equal(summary.netPremium, summary.netPremiumUnfiltered);
});

test("an empty tape yields null nets, never 0", () => {
  const { summary } = validateFlowTape([], SPOT, NOW);
  assert.equal(summary.netPremium, null);
  assert.equal(summary.netPremiumUnfiltered, null);
});

// ── Concentration ───────────────────────────────────────────────────────────────────────────
// Live SPX 2026-08-10 14:36 ET: net +$694.6M across 200 prints, of which ONE 7000-strike call was
// $169.1M — 13.3% of gross, 24.3% of |net|. A bare net cannot distinguish "market-wide flow is
// bullish" from "one desk bought a lot of one contract".

test("one dominant print is flagged, and is NOT excluded", () => {
  const tape = [
    { ...SPX_7800_CALL, strike: 7000, premium: 169_100_000 },
    ...Array.from({ length: 10 }, (_, i) => ({ ...SPX_7800_CALL, premium: 20_000_000 + i })),
  ];
  const { summary } = validateFlowTape(tape, SPOT, NOW);

  assert.equal(summary.concentrated, true);
  // The print is real directional premium and stays in the tally — this is disclosure, not a filter.
  assert.equal(summary.directional, 11);
  assert.ok(summary.netPremium! > 169_100_000);
  assert.ok(summary.topPrintShareOfGross! > 0.4);
  assert.equal(summary.topPrintPremium, 169_100_000);
});

test("an evenly spread tape is not flagged", () => {
  const tape = Array.from({ length: 40 }, (_, i) => ({ ...SPX_7800_CALL, premium: 1_000_000 + i }));
  const { summary } = validateFlowTape(tape, SPOT, NOW);
  assert.equal(summary.concentrated, false);
  assert.ok(summary.topPrintShareOfGross! < 0.05);
});

test("a modest print that IS the net gets flagged by the net test alone", () => {
  // Huge two-way tape, tiny net: no single print is a big share of GROSS, but one print is most
  // of the net. The gross test alone would miss this.
  const tape = [
    { ...SPX_7800_CALL, premium: 100_000_000 },
    { ...SPX_7800_CALL, option_type: "PUT", strike: 7700, premium: 96_000_000 },
    { ...SPX_7800_CALL, premium: 2_000_000 },
  ];
  const { summary } = validateFlowTape(tape, SPOT, NOW);
  assert.ok(summary.topPrintShareOfGross! < 0.55);
  assert.equal(summary.concentrated, true);
});

test("concentration is measured over DIRECTIONAL rows only", () => {
  // A deep-ITM print does not vote, so it must not set the concentration denominator either.
  const tape = [
    SPX_200_CALL, // excluded from directional
    { ...SPX_7800_CALL, premium: 5_000_000 },
    { ...SPX_7800_CALL, premium: 5_000_001 },
  ];
  const { summary } = validateFlowTape(tape, SPOT, NOW);
  assert.equal(summary.directional, 2);
  assert.equal(summary.grossPremium, 10_000_001);
  assert.equal(summary.topPrintPremium, 5_000_001);
});

test("an empty tape reports null concentration, never 0", () => {
  const { summary } = validateFlowTape([], SPOT, NOW);
  assert.equal(summary.grossPremium, null);
  assert.equal(summary.topPrintPremium, null);
  assert.equal(summary.topPrintShareOfGross, null);
  assert.equal(summary.concentrated, false);
});
