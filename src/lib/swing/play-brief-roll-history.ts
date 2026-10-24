import type { SwingRollHistoryLeg } from "./play-brief-types";

/**
 * Pure, zero-IO row→leg mapping for the roll-history narrative disclosure — lives in its own
 * file with no heavy imports (unlike play-brief-context.ts, which pulls in
 * fetchEcosystemContext/fetchVectorFullState and, transitively, gex-positioning.ts's
 * `server-only` guard) so it can be unit-tested directly without dragging in that whole chain.
 *
 * `contract_type` is stored as the full word "call"/"put" (see closed-plays.ts, live-plays.ts,
 * play-brief-resolve.ts — every other reader converts it the same way); `rollHistoryLine`'s
 * `fmtLeg` (play-brief-narrative.ts) checks the short "P"/"C" code, so passing `contract_type`
 * through unconverted made every roll leg fall through to "contract" (e.g. "$90 contract"
 * instead of "$90 put") — live repro 2026-09-11, INTC:35's first real rolled-chain closed brief
 * to hit production after this section originally shipped (#4802).
 *
 * BUG FIXED 2026-09-22 (Ask Largo standing mandate — Largo C3 absence). `contract_type` is a
 * genuinely nullable DB column (`TEXT`, no `NOT NULL`; `db.ts`'s `SwingPositionInsert.contract_type`
 * is `string | null` with `?? null` fallbacks at every insert site) — a roll leg can legitimately
 * have no recorded contract type. The old `r.contract_type === "put" ? "P" : "C"` ternary collapsed
 * that genuine absence into a fabricated "C" (call): `SwingRollHistoryLeg.right` is typed
 * `string | null` specifically so callers CAN represent "unknown", and `rollHistoryLine`'s
 * `fmtLeg` (play-brief-narrative.ts) already has an honest fallback wired for exactly this case
 * (`l.right === "P" ? "put" : l.right === "C" ? "call" : "contract"`) — but it was unreachable
 * because this mapper never emitted `null`. A trader reading "Rolled once — most recently from
 * the $90 call to..." on a leg whose true contract type was never recorded would be told a
 * fabricated direction instead of the honest generic "contract" the render layer was already
 * built to say. Now maps unrecognized/missing `contract_type` to `right: null`, letting the
 * existing honest fallback fire instead of inventing "C".
 */
export function swingRollHistoryLegFromRow(r: {
  roll_seq: number;
  contract_strike: number | null;
  contract_type: string | null;
  contract_expiry: string | null;
  committed_at: string | null;
}): SwingRollHistoryLeg {
  return {
    rollSeq: r.roll_seq,
    strike: r.contract_strike,
    right: r.contract_type === "put" ? "P" : r.contract_type === "call" ? "C" : null,
    expiry: r.contract_expiry,
    committedAt: r.committed_at,
  };
}
