/**
 * Bridge the live 0DTE board payload → the unified three-board (remodel: "complete the 0DTE system").
 *
 * getZeroDteBoardPayload() (platform/zerodte-service.ts) is the live read of the always-on 0DTE engine:
 * the enriched fresh-find setups + the graded session ledger (with each row's live lifecycle status). This
 * pure function turns that into the ZERO_DTE lane of the unified HorizonBoard — adapting the setups through
 * the proven-engine adapter and keying the ledger's live statuses so an already-committed working play
 * reads as COMMIT. SWING / LEAPS are left empty here; the whole-market discovery slice fills them.
 *
 * PURE & deterministic — no IO, TYPE-ONLY import of the payload so this never drags the service's provider
 * graph in. The route fetches the payload and hands it here.
 */

import type { ZeroDteBoardPayload } from "../platform/zerodte-service";
import { zeroDteSetupsToHorizonPlays } from "./horizon-adapter";
import { assembleHorizonBoard, makePlaySet, type HorizonBoard } from "../horizon-board";

export function horizonBoardFromZeroDtePayload(payload: ZeroDteBoardPayload, asOf: string): HorizonBoard {
  // The ledger carries the authoritative live lifecycle (OPEN/HOLD/TRIM/CLOSED) per committed play; key it
  // by upper-cased ticker so the adapter can mark an already-working play COMMIT even after its fresh-find
  // gate context has aged out.
  const statusByTicker = new Map<string, string | null>();
  for (const row of payload.ledger) statusByTicker.set(row.ticker.toUpperCase(), row.status);
  const zeroDte = zeroDteSetupsToHorizonPlays(payload.setups, statusByTicker);
  return assembleHorizonBoard(makePlaySet({ ZERO_DTE: zeroDte }), asOf);
}
