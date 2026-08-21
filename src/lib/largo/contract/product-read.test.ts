import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canonicalTicker,
  contractViolations,
  productRead,
  productUnavailable,
  signalViolations,
  type ProductReadMeta,
} from "./product-read";

const META: ProductReadMeta = {
  product: "vector",
  as_of: "2026-08-21 09:31 ET",
  freshness: "live",
  age_seconds: 4,
  source: "unusual_whales",
};

test("an ok read carries data and passes the contract", () => {
  const read = productRead(META, { pulse: [] });
  assert.equal(read.ok, true);
  assert.deepEqual(contractViolations(read), []);
});

test("absence must state WHY — the Vector has_baseline case the contract exists for", () => {
  // The whole point: "no baseline yet" and "the tape is quiet" are both an empty list. Only one is
  // a finding, and the payload must say which.
  const read = productUnavailable(META, {
    reason: "no_baseline",
    what_is_missing: "no previous snapshot this session to diff against",
    retryable: true,
  });
  assert.equal(read.ok, false);
  assert.deepEqual(contractViolations(read), []);
  if (read.ok === false) {
    assert.equal(read.unavailable.reason, "no_baseline");
    assert.equal(read.unavailable.retryable, true);
  }
});

test("the union makes C3 structurally unviolatable", () => {
  // An empty array as the whole answer is not a read at all — it carries no time, no provenance and
  // no statement of why it is empty. Every one of those is reported.
  const bare = contractViolations([]);
  assert.ok(bare.length > 0);

  // ok:false with no reason is refused rather than accepted as "empty".
  const silent = { ...META, ok: false };
  const v = contractViolations(silent);
  assert.ok(
    v.some((m) => m.includes("unavailable")),
    `expected an unavailable violation, got ${JSON.stringify(v)}`
  );
});

test("as_of must be an ET stamp — never an epoch, never a bare date", () => {
  assert.deepEqual(contractViolations({ ...META, ok: true, data: 1 }), []);
  for (const bad of [1787202000000, "2026-08-21", "2026-08-21T13:31:00Z", null, undefined]) {
    const v = contractViolations({ ...META, as_of: bad, ok: true, data: 1 });
    assert.ok(v.some((m) => m.startsWith("as_of")), `${JSON.stringify(bad)} should be refused`);
  }
});

test("freshness and age must both be present and valid", () => {
  assert.ok(
    contractViolations({ ...META, freshness: "fresh", ok: true, data: 1 }).some((m) =>
      m.startsWith("freshness")
    )
  );
  assert.ok(
    contractViolations({ ...META, age_seconds: "4", ok: true, data: 1 }).some((m) =>
      m.startsWith("age_seconds")
    )
  );
  // null age is legitimate — some reads genuinely have no measurable age.
  assert.deepEqual(contractViolations({ ...META, age_seconds: null, ok: true, data: 1 }), []);
});

test("ticker identity is canonical — SPX, never I:SPX or SPXW", () => {
  assert.equal(canonicalTicker("I:SPX"), "SPX");
  assert.equal(canonicalTicker("SPXW"), "SPX");
  assert.equal(canonicalTicker("spx"), "SPX");
  assert.equal(canonicalTicker(" nvda "), "NVDA");
  assert.equal(canonicalTicker("SPY"), "SPY", "SPY is its own instrument, not an SPX alias");
});

test("a compliant signal passes; a raw sign or a bare claim does not", () => {
  const good = {
    ticker: "SPX",
    ticker_class: "index" as const,
    direction: "bearish" as const,
    evidence: ["call wall 7700 holds 3.2x the gamma of the next strike", "spot 7641"],
    confidence: { score: 0.62, basis: "18 comparable short-gamma sessions", sample_size: 18 },
    native: { posture: "short_gamma", severity_tier: 1 },
  };
  assert.deepEqual(signalViolations(good), []);

  // Non-canonical ticker is caught — this is what makes an SPX/SPY mix-up impossible to join wrongly.
  assert.ok(signalViolations({ ...good, ticker: "I:SPX" }).some((m) => m.includes("canonical")));

  // Evidence must be actual numbers, not a restatement.
  assert.ok(signalViolations({ ...good, evidence: [] }).some((m) => m.startsWith("evidence")));

  // A raw sign is not a direction.
  assert.ok(signalViolations({ ...good, direction: -1 }).some((m) => m.startsWith("direction")));
});

test("confidence is OPTIONAL — omitting it is compliant, faking it is not", () => {
  const base = {
    ticker: "NVDA",
    ticker_class: "equity" as const,
    direction: "bullish" as const,
    evidence: ["net premium +4.2M on the 09:45 sweep"],
  };
  // A product that cannot calibrate omits the field and is fully compliant. This is deliberate:
  // an invented 0.7 would be compared against another lane's measured one.
  assert.deepEqual(signalViolations(base), []);

  // Present-but-malformed IS the failure.
  assert.ok(
    signalViolations({ ...base, confidence: { score: 0.7 } }).some((m) => m.includes("basis"))
  );
  assert.ok(
    signalViolations({ ...base, confidence: { score: 7, basis: "x", sample_size: null } }).some((m) =>
      m.includes("0..1")
    )
  );
});

test("native product intelligence survives — the contract wraps, it does not flatten", () => {
  const read = productRead(META, {
    pulse_signals: [{ kind: "regime-flip", tier: 1, why: "gamma flipped at 7650" }],
    has_baseline: true,
  });
  assert.deepEqual(contractViolations(read), []);
  if (read.ok) {
    // The product's own shape is untouched and fully addressable.
    assert.equal(read.data.pulse_signals[0].kind, "regime-flip");
    assert.equal(read.data.has_baseline, true);
  }
});
