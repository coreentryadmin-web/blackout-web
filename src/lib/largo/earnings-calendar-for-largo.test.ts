import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  shapeEarningsCalendarRead,
  type EarningsCalendarEnvelope,
} from "./earnings-calendar-for-largo";

/** A realistic transport envelope from callInternalApiRead. */
function envelope(data: unknown, over: Partial<EarningsCalendarEnvelope> = {}) {
  return {
    ok: true,
    status: 200,
    // `path` and `area` really are on the envelope — kept here so the "don't leak transport"
    // assertion below is testing against the true shape, not a convenient one.
    path: "/api/market/earnings-calendar",
    area: "market",
    data,
    ...over,
  } as EarningsCalendarEnvelope;
}

describe("shapeEarningsCalendarRead: the envelope is not the payload", () => {
  test("a ticker WITH a calendar date returns that date — the regression this fixes", () => {
    // Before the fix the case tested `"earnings" in res` against the ENVELOPE. That is never
    // true, so the map was always {} and this exact call replied "No upcoming date for NVDA"
    // while the calendar plainly held 2026-08-26.
    const read = shapeEarningsCalendarRead(
      envelope({ earnings: { NVDA: "2026-08-26", WMT: "2026-08-20" }, configured: true }),
      "NVDA"
    );

    assert.equal(read.available, true);
    assert.equal(read.configured, true);
    assert.equal("next_report_date" in read && read.next_report_date, "2026-08-26");
    assert.deepEqual(read.earnings, { NVDA: "2026-08-26" });
    assert.equal(
      "note" in read ? read.note : undefined,
      undefined,
      "a found date must not carry a not-found note"
    );
  });

  test("reading the envelope as the body — the old behaviour — is what this rejects", () => {
    // Guards the specific mis-read rather than only its symptom: the envelope has no
    // top-level `earnings`, so any future refactor that reaches for one gets nothing.
    const env = envelope({ earnings: { NVDA: "2026-08-26" }, configured: true });
    assert.equal("earnings" in env, false, "envelope must not carry a top-level earnings key");
  });

  test("a genuinely absent date says so, and says the calendar WAS configured", () => {
    const read = shapeEarningsCalendarRead(
      envelope({ earnings: { WMT: "2026-08-20" }, configured: true }),
      "NVDA"
    );

    assert.equal(read.available, true);
    assert.equal(read.configured, true);
    assert.equal("next_report_date" in read && read.next_report_date, null);
    assert.match(String("note" in read ? read.note : ""), /within the calendar's 3-month horizon/);
  });

  test("an UNCONFIGURED calendar must not read as 'this ticker has no report'", () => {
    // The route serves { earnings: {}, configured: false } when ALPHAVANTAGE_API_KEY is unset.
    // That is empty for every ticker on earth — a fact about our deployment, not about NVDA.
    const read = shapeEarningsCalendarRead(
      envelope({ earnings: {}, configured: false }),
      "NVDA"
    );

    assert.equal(read.configured, false);
    assert.equal("next_report_date" in read && read.next_report_date, null);
    assert.match(String("note" in read ? read.note : ""), /NOT evidence/);
  });

  test("a missing `configured` flag defaults to false, never to true", () => {
    const read = shapeEarningsCalendarRead(envelope({ earnings: {} }), "NVDA");
    assert.equal(read.configured, false);
  });

  test("a failed read reports available:false, never a fabricated absence", () => {
    const read = shapeEarningsCalendarRead(
      { ok: false, status: 503, error: "fetch_failed" },
      "NVDA"
    );

    assert.equal(read.available, false);
    assert.equal(read.configured, null);
    assert.equal("error" in read && read.error, "fetch_failed");
    assert.match(String("note" in read ? read.note : ""), /NOT evidence/);
  });

  test("a failed read with no error string still carries the status", () => {
    const read = shapeEarningsCalendarRead({ ok: false, status: 502 }, "NVDA");
    assert.match(String("error" in read ? read.error : ""), /HTTP 502/);
  });

  test("a null/undefined envelope is a failed read, not an empty calendar", () => {
    for (const bad of [null, undefined]) {
      const read = shapeEarningsCalendarRead(bad, "NVDA");
      assert.equal(read.available, false, `${bad} must not read as an available calendar`);
    }
  });

  test("unfiltered returns the calendar itself, not the transport envelope", () => {
    const read = shapeEarningsCalendarRead(
      envelope({ earnings: { NVDA: "2026-08-26", WMT: "2026-08-20" }, configured: true }),
      null
    );

    assert.equal("count" in read && read.count, 2);
    assert.deepEqual(read.earnings, { NVDA: "2026-08-26", WMT: "2026-08-20" });
    // The envelope's internals are transport, not market data — the old code returned the
    // whole envelope verbatim on this branch, handing the model `path`/`area`/`ok`.
    for (const leak of ["path", "area", "ok", "status", "data"]) {
      assert.equal(leak in read, false, `${leak} is transport and must not reach the model`);
    }
  });

  test("a symbol colliding with an Object.prototype member resolves to no date, not a function", () => {
    // `earnings` is built from upstream CSV, so a bare bracket lookup would fall through to
    // the prototype chain and hand back a function where an ISO date belongs.
    const read = shapeEarningsCalendarRead(
      envelope({ earnings: { NVDA: "2026-08-26" }, configured: true }),
      "constructor"
    );

    assert.equal("next_report_date" in read && read.next_report_date, null);
    assert.deepEqual(read.earnings, {});
  });
});
