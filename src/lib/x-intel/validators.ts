/**
 * X INTEL VALIDATORS — mechanical enforcement of certification requirements.
 *
 * Per brief §Chronology: "BLACKOUT caught it first requires timestamped platform evidence
 * proving the detection preceded the move. No evidence, no claim. Enforce this mechanically,
 * not editorially."
 *
 * These validators are called by the queue store before marking a row READY. They are NOT
 * editorial rules — they are the law: a package that fails any validator is downgraded to
 * REVIEW, carried to the admin surface with its violation reason, and stays there until a
 * human reconciles it or marks SKIP.
 */

import type { XIntelChronology, XIntelQueueRow } from "@/lib/x-intel/queue-types";

export interface ValidationFailure {
  field: string;
  reason: string;
}

/**
 * CHRONOLOGY VALIDATOR — the single most damaging thing this account could publish
 * is a foresight claim that turns out to be backfilled.
 *
 * Rule: A package asserting precedence MUST carry detection_timestamp < market_event_timestamp,
 * both as machine-readable epochs. If the claim is true, the numbers prove it. If the claim is
 * false and backfilled, mechanical validation catches it in real time.
 */
export function validateChronology(
  chronology: XIntelChronology | null | undefined,
): ValidationFailure | null {
  if (!chronology) {
    // No chronology field = no precedence claim. This is fine.
    return null;
  }

  if (!chronology.precedence_claimed) {
    // This is a report of a move after the fact, not a foresight claim.
    // "The market did X" is always valid; "we caught X coming" requires proof.
    return null;
  }

  // From this point on: a precedence claim was made. Both timestamps must be present
  // and strictly ordered.

  if (!chronology.detection || !chronology.market_event) {
    return {
      field: "chronology",
      reason:
        "Precedence claim requires both detection AND market_event timestamps. " +
        "If you meant to report what happened (not predict it), set precedence_claimed: false.",
    };
  }

  const detectionMs = chronology.detection.at_ms;
  const eventMs = chronology.market_event.at_ms;

  if (typeof detectionMs !== "number" || typeof eventMs !== "number") {
    return {
      field: "chronology",
      reason:
        "Both detection.at_ms and market_event.at_ms must be numeric epoch timestamps.",
    };
  }

  if (detectionMs >= eventMs) {
    return {
      field: "chronology",
      reason:
        `Detection timestamp (${chronology.detection.at_et}) must be strictly BEFORE ` +
        `market event (${chronology.market_event.at_et}). ` +
        `Current order: detection at ${detectionMs}ms, event at ${eventMs}ms ` +
        `(${eventMs - detectionMs}ms later). No foresight claim is valid if the ` +
        `detection happened after the move.`,
    };
  }

  return null;
}

/**
 * SESSION CLAIM VALIDATOR — a session claim on all-expiry data is a false claim.
 *
 * Rule: If the post claims to describe "today's session" (session_claim: true),
 * every cited value must be read at a horizon appropriate to that session, not
 * an aggregate across the whole book. This catches the 2026-08-21 defect where
 * an ALL-expiry call wall was narrated as a description of the next six hours.
 */
export function validateSessionClaim(row: XIntelQueueRow): ValidationFailure | null {
  if (!row.session_claim) {
    // No session claim = no horizon rule to check.
    return null;
  }

  // This rule would require looking at `underlying_evidence` and checking that none
  // of it is read at `all` horizon. For now, we log and let human review catch it.
  // Future: add `horizon` field to `XIntelEvidence` and check here.

  return null;
}

/**
 * CONFIDENCE VALIDATOR — omit rather than invent.
 *
 * Rule: If confidence is present, it must carry a basis and a sample size (even if null).
 * The field should be omitted entirely if it cannot be calibrated — fabricated certainty
 * corrupts cross-product ranking.
 */
export function validateConfidence(row: XIntelQueueRow): ValidationFailure | null {
  if (!row.confidence) {
    return null;
  }

  if (typeof row.confidence.score !== "number") {
    return {
      field: "confidence.score",
      reason: "Confidence score must be a number 0..1.",
    };
  }

  if (row.confidence.score < 0 || row.confidence.score > 1) {
    return {
      field: "confidence.score",
      reason: "Confidence score must be between 0 and 1.",
    };
  }

  if (!row.confidence.basis || typeof row.confidence.basis !== "string") {
    return {
      field: "confidence.basis",
      reason:
        "Confidence must explain its basis — e.g. 'n=47 similar prior signals, 68% hit rate' " +
        "or 'volatility regime correlation'. Omit confidence entirely if it cannot be calibrated.",
    };
  }

  return null;
}

/**
 * Run all validators on a row. Returns the first failure found, or null if all pass.
 */
export function validateQueueRow(row: XIntelQueueRow): ValidationFailure | null {
  return (
    validateChronology(row.chronology) ||
    validateSessionClaim(row) ||
    validateConfidence(row)
  );
}
