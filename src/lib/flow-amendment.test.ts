import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeAmendmentLedger,
  amendmentIdentity,
  detectAmendmentFromRaw,
  type AmendableEvent,
} from "./flow-amendment";

test("an amended print SUPERSEDES the original in aggregation (no double count)", () => {
  const led = makeAmendmentLedger();
  // Original print of an underlying event, premium 300k.
  const original: AmendableEvent = { alert_id: "uw:1", event_key: "evt-A", version: 1, premium: 300_000 };
  // A correction of the SAME event revises premium up to 500k (delivered as a new alert_id).
  const amended: AmendableEvent = {
    alert_id: "uw:2",
    event_key: "evt-A",
    amends_id: "uw:1",
    version: 2,
    premium: 500_000,
  };

  assert.equal(led.apply(original).action, "insert");
  assert.equal(led.apply(amended).action, "supersede");

  // Aggregation reads ONLY the latest amendment — 500k, NOT 300k + 500k = 800k.
  assert.equal(led.size(), 1);
  assert.equal(led.aggregatePremium(), 500_000);
  assert.equal(led.get("evt-A")?.premium, 500_000);
});

test("amendment handling is idempotent — replaying the same amendment is a no-op", () => {
  const led = makeAmendmentLedger();
  const original: AmendableEvent = { alert_id: "uw:1", event_key: "evt-B", version: 1, premium: 100_000 };
  const amended: AmendableEvent = { alert_id: "uw:2", event_key: "evt-B", version: 2, premium: 250_000 };
  led.apply(original);
  led.apply(amended);
  assert.equal(led.apply(amended).action, "duplicate", "same amendment again = duplicate");
  assert.equal(led.aggregatePremium(), 250_000);
  assert.equal(led.size(), 1);
});

test("a stale (older-version) amendment is ignored — latest wins", () => {
  const led = makeAmendmentLedger();
  led.apply({ alert_id: "uw:2", event_key: "evt-C", version: 3, premium: 400_000 });
  const late = led.apply({ alert_id: "uw:1", event_key: "evt-C", version: 1, premium: 100_000 });
  assert.equal(late.action, "ignore_stale");
  assert.equal(led.aggregatePremium(), 400_000);
});

test("versionless amendments order by receipt time", () => {
  const led = makeAmendmentLedger();
  led.apply({ alert_id: "uw:1", event_key: "evt-D", received_at: 10, premium: 100 });
  const newer = led.apply({ alert_id: "uw:2", event_key: "evt-D", received_at: 20, premium: 300 });
  assert.equal(newer.action, "supersede");
  assert.equal(led.aggregatePremium(), 300);
});

test("distinct events with no amendment linkage are counted independently", () => {
  const led = makeAmendmentLedger();
  led.apply({ alert_id: "uw:a", premium: 100 });
  led.apply({ alert_id: "uw:b", premium: 200 });
  assert.equal(led.size(), 2);
  assert.equal(led.aggregatePremium(), 300);
});

test("amendmentIdentity prefers event_key, then amends_id, then alert_id", () => {
  assert.equal(amendmentIdentity({ alert_id: "id", event_key: "k", amends_id: "a", premium: 0 }), "k");
  assert.equal(amendmentIdentity({ alert_id: "id", amends_id: "a", premium: 0 }), "a");
  assert.equal(amendmentIdentity({ alert_id: "id", premium: 0 }), "id");
});

test("detectAmendmentFromRaw is conservative — a plain print is not flagged", () => {
  const plain = detectAmendmentFromRaw({ alert_id: "uw:1", premium: 250_000 });
  assert.equal(plain.amended, false);
  assert.equal(plain.event_key, null);
  assert.equal(plain.amends_id, null);

  const corrected = detectAmendmentFromRaw({ corrected: true, amends_alert_id: "uw:1", version: 2 });
  assert.equal(corrected.amended, true);
  assert.equal(corrected.amends_id, "uw:1");
  assert.equal(corrected.version, 2);
});
