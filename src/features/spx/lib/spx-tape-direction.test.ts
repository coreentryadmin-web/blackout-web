import test from "node:test";
import assert from "node:assert/strict";
import {
  spxTapeSkew,
  spxTapeVerdict,
  spxFlowSkew,
  SPX_TAPE_MIN_NOTIONAL,
} from "./spx-tape-direction";

/** Ask-side shares that land unambiguously in each bucket (thresholds are 60 / 40). */
const BOUGHT = 85;
const SOLD = 12;
const MID = 50;

test("the defect: aggressively SOLD calls are BEARISH, not bullish premium", () => {
  const sold = [
    { side: "call" as const, premium: 1_000_000, ask_pct: SOLD },
    { side: "call" as const, premium: 1_000_000, ask_pct: SOLD },
  ];
  // ANTI-VACUOUS: the old rule (option type alone) would have called this $2M of BULLISH premium.
  assert.equal(
    sold.filter((t) => t.side === "call").reduce((s, t) => s + t.premium, 0),
    2_000_000
  );
  const skew = spxTapeSkew(sold);
  assert.equal(skew.bull, 0);
  assert.equal(skew.bear, 2_000_000);
  assert.equal(spxTapeVerdict(skew).verdict, "bearish");
});

test("SOLD puts are BULLISH — the other half of the four-way table", () => {
  const skew = spxTapeSkew([{ side: "put", premium: 900_000, ask_pct: SOLD }]);
  assert.equal(skew.bull, 900_000);
  assert.equal(skew.bear, 0);
  assert.equal(spxTapeVerdict(skew).verdict, "bullish");
});

test("BOUGHT calls stay bullish and BOUGHT puts stay bearish", () => {
  assert.equal(spxTapeSkew([{ side: "call", premium: 1e6, ask_pct: BOUGHT }]).bull, 1e6);
  assert.equal(spxTapeSkew([{ side: "put", premium: 1e6, ask_pct: BOUGHT }]).bear, 1e6);
});

test("an unreadable print is UNREADABLE, never balanced or bullish", () => {
  // Both premium legs zero -> ask_pct null. This is ~36% of live SPX prints (18/50, 2026-08-23).
  const skew = spxTapeSkew([
    { side: "call", premium: 5_000_000, ask_pct: null },
    { side: "put", premium: 100_000, ask_pct: undefined },
  ]);
  assert.equal(skew.bull, 0);
  assert.equal(skew.bear, 0);
  assert.equal(skew.unreadable, 5_100_000);
});

test("a midpoint print is undetermined — a 50%-at-ask print is not a small bullish print", () => {
  const skew = spxTapeSkew([{ side: "call", premium: 2_000_000, ask_pct: MID }]);
  assert.equal(skew.unreadable, 2_000_000);
  assert.equal(skew.bull, 0);
});

test("the factor stays SILENT when unreadable premium is the majority", () => {
  // Readable side leads 3:1 and clears the notional floor on its own — the ONLY thing stopping a
  // verdict here is that most of the window could not be read at all.
  const skew = spxTapeSkew([
    { side: "call", premium: 900_000, ask_pct: BOUGHT },
    { side: "put", premium: 300_000, ask_pct: BOUGHT },
    { side: "call", premium: 9_000_000, ask_pct: null },
  ]);
  assert.equal(skew.bull, 900_000);
  assert.equal(skew.bear, 300_000);
  // ANTI-VACUOUS: without the unreadable majority this window WOULD have fired bullish.
  assert.equal(spxTapeVerdict({ bull: 900_000, bear: 300_000, unreadable: 0 }).verdict, "bullish");
  const v = spxTapeVerdict(skew);
  assert.equal(v.verdict, "none");
  assert.equal(v.reason, "unreadable");
});

test("'unreadable' and 'thin' are distinguished — they are different facts about the tape", () => {
  assert.equal(spxTapeVerdict({ bull: 1000, bear: 500, unreadable: 0 }).reason, "thin");
  assert.equal(spxTapeVerdict({ bull: 0, bear: 0, unreadable: 8_000_000 }).reason, "unreadable");
});

test("a balanced readable window reports 'balanced', not a coin-flip direction", () => {
  const v = spxTapeVerdict({ bull: 1_000_000, bear: 950_000, unreadable: 0 });
  assert.equal(v.verdict, "none");
  assert.equal(v.reason, "balanced");
});

test("the notional floor is applied to READABLE premium only", () => {
  const justUnder = SPX_TAPE_MIN_NOTIONAL;
  assert.equal(spxTapeVerdict({ bull: justUnder, bear: 0, unreadable: 0 }).reason, "thin");
  assert.equal(spxTapeVerdict({ bull: justUnder + 1, bear: 0, unreadable: 0 }).verdict, "bullish");
});

test("dark-pool (neutral) rows are excluded, not counted as unreadable", () => {
  const skew = spxTapeSkew([
    { side: "neutral", premium: 50_000_000, ask_pct: null },
    { side: "call", premium: 1_000_000, ask_pct: BOUGHT },
  ]);
  assert.equal(skew.unreadable, 0);
  assert.equal(spxTapeVerdict(skew).verdict, "bullish");
});

test("ISSUE-35 guard retained: a null premium cannot poison the sums with NaN", () => {
  const skew = spxTapeSkew([
    { side: "call", premium: null as unknown as number, ask_pct: BOUGHT },
    { side: "call", premium: 1_000_000, ask_pct: BOUGHT },
  ]);
  assert.equal(skew.bull, 1_000_000);
  assert.ok(Number.isFinite(skew.bear) && Number.isFinite(skew.unreadable));
});

test("spxFlowSkew drops UNKNOWN-side prints rather than bucketing them anywhere", () => {
  const skew = spxFlowSkew([
    { option_type: "UNKNOWN", premium: 4_000_000, ask_pct: SOLD },
    { option_type: "CALL", premium: 1_000_000, ask_pct: SOLD },
  ]);
  assert.equal(skew.bull, 0);
  assert.equal(skew.bear, 1_000_000); // sold call
  assert.equal(skew.unreadable, 0); // the typeless print is absent entirely, not "unreadable"
});

test("spxFlowSkew and spxTapeSkew agree on the same prints — one rule, two entry points", () => {
  const flows = [
    { option_type: "CALL", premium: 700_000, ask_pct: SOLD },
    { option_type: "PUT", premium: 400_000, ask_pct: BOUGHT },
    { option_type: "CALL", premium: 250_000, ask_pct: BOUGHT },
  ];
  const viaTape = spxTapeSkew([
    { side: "call", premium: 700_000, ask_pct: SOLD },
    { side: "put", premium: 400_000, ask_pct: BOUGHT },
    { side: "call", premium: 250_000, ask_pct: BOUGHT },
  ]);
  assert.deepEqual(spxFlowSkew(flows), viaTape);
});
