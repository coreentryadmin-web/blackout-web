"use client";

import { formatGexChange } from "@/lib/largo/core/gex-shift-extract";
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";

/**
 * Strike-level GEX-change panel (`envelope.gexShifts`). Structured off the turn's own
 * `get_gex_matrix_changes` tool result (see `gex-shift-extract.ts`) — never parsed back out of
 * prose. Renders nothing when the tool was not called this turn.
 *
 * BUG FIX (Ask Largo standing mandate, 2026-11-09): `BieAnswer.tsx` is the renderer used for a
 * NOT-rich-enough envelope (`LargoAnswerMessage`'s own `richEnough` gate only checks
 * `headline`/`bias`/`levels`/`sections`/`tradeDecision` — none of which `gexShifts` affects) and
 * for the no-envelope markdown-shim path. `LargoDeskRead.tsx` (the sibling "Deep dive, rich
 * enough" renderer) already renders `envelope.gexShifts` as a "GEX shift" block; `BieAnswer.tsx`
 * never read the field at all, so a turn that called `get_gex_matrix_changes` but wrote no
 * canonical section/level text (plausible — the two are extracted independently, see
 * `answer-contract.ts`) silently lost that structured table the moment the answer fell one rung
 * short of `richEnough`.
 */
export function BieGexShiftsPanel({
  shifts,
  label = "GEX shift",
}: {
  shifts: BieAnswerEnvelope["gexShifts"];
  label?: string;
}) {
  if (!shifts || shifts.length === 0) return null;
  return (
    <div className="bie-evidence">
      <p className="bie-block-label">{label}</p>
      <ul className="bie-evidence-list">
        {shifts.map((g) => (
          <li key={g.strike} className="bie-evidence-item">
            <span className="bie-evidence-text">
              {g.strike.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
            <span>{formatGexChange(g.change)}</span>
            <span>{g.direction}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
