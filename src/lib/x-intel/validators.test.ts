import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateChronology, validateConfidence, validateSessionClaim } from "@/lib/x-intel/validators";
import type { XIntelQueueRow } from "@/lib/x-intel/queue-types";

describe("x-intel validators", () => {
  describe("chronology validator", () => {
    it("passes when no chronology is provided", () => {
      const result = validateChronology(null);
      assert.equal(result, null);
    });

    it("passes when precedence is not claimed", () => {
      const result = validateChronology({
        precedence_claimed: false,
        detection: null,
        market_event: null,
        marks: [],
      });
      assert.equal(result, null);
    });

    it("fails when precedence is claimed but detection is missing", () => {
      const result = validateChronology({
        precedence_claimed: true,
        detection: null,
        market_event: {
          at_et: "2026-08-21 10:34 ET",
          at_ms: 1000,
          what: "price break",
        },
        marks: [],
      });
      assert(result);
      assert.match(result.reason, /requires both/i);
    });

    it("fails when precedence is claimed but market_event is missing", () => {
      const result = validateChronology({
        precedence_claimed: true,
        detection: {
          at_et: "2026-08-21 10:30 ET",
          at_ms: 900,
          what: "signal detected",
          surface: "helix",
        },
        market_event: null,
        marks: [],
      });
      assert(result);
      assert.match(result.reason, /requires both/i);
    });

    it("fails when detection is not strictly before market event", () => {
      const result = validateChronology({
        precedence_claimed: true,
        detection: {
          at_et: "2026-08-21 10:34 ET",
          at_ms: 1000,
          what: "signal detected",
          surface: "helix",
        },
        market_event: {
          at_et: "2026-08-21 10:34 ET",
          at_ms: 1000,
          what: "price break",
        },
        marks: [],
      });
      assert(result);
      assert.match(result.reason, /strictly BEFORE/i);
    });

    it("fails when detection is after market event", () => {
      const result = validateChronology({
        precedence_claimed: true,
        detection: {
          at_et: "2026-08-21 10:40 ET",
          at_ms: 1100,
          what: "signal detected",
          surface: "helix",
        },
        market_event: {
          at_et: "2026-08-21 10:34 ET",
          at_ms: 1000,
          what: "price break",
        },
        marks: [],
      });
      assert(result);
      assert.match(result.reason, /strictly BEFORE/i);
    });

    it("passes when detection is strictly before market event", () => {
      const result = validateChronology({
        precedence_claimed: true,
        detection: {
          at_et: "2026-08-21 10:30 ET",
          at_ms: 900,
          what: "signal detected",
          surface: "helix",
        },
        market_event: {
          at_et: "2026-08-21 10:34 ET",
          at_ms: 1000,
          what: "price break",
        },
        marks: [],
      });
      assert.equal(result, null);
    });
  });

  describe("confidence validator", () => {
    it("passes when confidence is not provided", () => {
      const result = validateConfidence({ confidence: null } as any);
      assert.equal(result, null);
    });

    it("fails when score is not a number", () => {
      const result = validateConfidence({
        confidence: {
          score: "0.75",
          basis: "test",
          sample_size: 10,
        },
      } as any);
      assert(result);
      assert.match(result.reason, /must be a number/i);
    });

    it("fails when score is out of range", () => {
      const result = validateConfidence({
        confidence: {
          score: 1.5,
          basis: "test",
          sample_size: 10,
        },
      } as any);
      assert(result);
      assert.match(result.reason, /between 0 and 1/i);
    });

    it("fails when basis is missing", () => {
      const result = validateConfidence({
        confidence: {
          score: 0.75,
          basis: "",
          sample_size: 10,
        },
      } as any);
      assert(result);
      assert.match(result.reason, /must explain its basis/i);
    });

    it("passes when all fields are valid", () => {
      const result = validateConfidence({
        confidence: {
          score: 0.75,
          basis: "n=47 similar prior signals, 68% hit rate",
          sample_size: 47,
        },
      } as any);
      assert.equal(result, null);
    });
  });

  describe("session claim validator", () => {
    it("passes when no session claim is made", () => {
      const result = validateSessionClaim({
        session_claim: false,
        underlying_evidence: [
          { what: "call wall", value: "7,900", source: "thermal", horizon: "all" },
        ],
      } as unknown as XIntelQueueRow);
      assert.equal(result, null);
    });

    it("fails a session claim resting entirely on far-dated (all-expiry) evidence", () => {
      // Regression: this validator used to be a stale stub that ALWAYS returned null for a
      // session_claim row, regardless of horizon -- a stray comment even said "we log", but it
      // never did, and never actually checked underlying_evidence. It silently un-fixed the
      // exact opposite-story defect readyBlockReason (queue-types.ts) already pays to prevent.
      const result = validateSessionClaim({
        session_claim: true,
        underlying_evidence: [
          { what: "call wall", value: "7,900", source: "thermal", horizon: "all" },
          { what: "net GEX", value: "-$39.2B", source: "thermal", horizon: "all" },
        ],
      } as unknown as XIntelQueueRow);
      assert(result, "expected a validation failure for a far-dated session claim");
      assert.equal(result.field, "session_claim");
      assert.match(result.reason, /far-dated.*today's session/s);
    });

    it("fails a session claim resting entirely on monthly-expiry evidence, same as all-expiry", () => {
      const result = validateSessionClaim({
        session_claim: true,
        underlying_evidence: [
          { what: "call wall", value: "7,900", source: "thermal", horizon: "monthly" },
        ],
      } as unknown as XIntelQueueRow);
      assert(result);
      assert.match(result.reason, /far-dated.*today's session/s);
    });

    it("passes a session claim resting on 0dte/near evidence", () => {
      const result = validateSessionClaim({
        session_claim: true,
        underlying_evidence: [
          { what: "call wall", value: "7,700", source: "thermal", horizon: "0dte" },
        ],
      } as unknown as XIntelQueueRow);
      assert.equal(result, null);
    });
  });
});
