/**
 * What the SPX tape says about direction — the ONE rule the desk's tape factor scores.
 *
 * ── THE DEFECT THIS REPLACES ────────────────────────────────────────────────────────────────────
 *
 * `tapeSkew` scored the last 8 flow prints by option TYPE alone: every call print counted as
 * bullish premium, every put print as bearish. It never asked whether those calls were BOUGHT or
 * SOLD. A block of aggressively-sold calls — bearish on the rule this product already ships
 * elsewhere (`printBias` in the HELIX contract drilldown, `flowDirection` in Split Flow) — was
 * scored as bullish conviction and moved the SPX confluence score by +12.
 *
 * MEASURED on the tape the desk actually fetches (UW `GET /api/stock/SPX/flow-alerts`, the source
 * behind every one of the 32 `spx_flows` rows the live desk served on 2026-08-23):
 *   - `ask_side_pct`: 0/50 rows. `total_ask_side_prem` + `total_bid_side_prem`: 50/50 rows.
 *     So the aggressor is never SENT, and always DERIVABLE — except where both legs are zero
 *     (18/50 SPX, 3/50 SPXW), which is a genuine unknown and stays one.
 *   - After derivation, 32/50 SPX prints carry a readable ask-side share and 27/50 are decisive
 *     (>=60 bought / <=40 sold).
 *   - Over the 168h DB tape (993 8-print windows, the exact slice `tapeSkew` scores):
 *     **167 windows — 16.8% — SIGN-FLIP**, i.e. the shipped rule pushed the score +12 where the
 *     aggressor-aware rule says -12, or the reverse. A 24-point swing on a grade scale whose
 *     boundaries are 72 / 58 / 45 / 30.
 *
 * ── WHY IT IS NOT A DROP-IN SWAP ────────────────────────────────────────────────────────────────
 *
 * Roughly a third of prints cannot be read at all, and the largest prints are the least readable
 * ($5M+ SPX prints: 0% carry a two-sided split). Scoring those as "balanced" would be the same
 * fabrication in a new costume — a tape with no aggressor data would read as perfect equilibrium
 * and silently damp a real skew. So unreadable premium is tracked as its own third bucket and the
 * factor stays SILENT when it is the majority: a verdict resting on a minority of the premium is
 * not a verdict. That is the same guard `directionLabel` already applies in the HELIX lane, stated
 * here for the tape's own thresholds rather than re-derived.
 *
 * The four-way table itself is imported, not re-implemented. Two lanes reading the same prints
 * must not be able to drift into disagreeing about what "bullish" means — that is the
 * two-derivations-of-one-number failure this repo keeps paying for.
 */
import { flowDirection } from "@/features/helix/lib/helix-flow-aggression";

export type SpxTapeDirectionInput = {
  side: "call" | "put" | "neutral";
  premium: number;
  /** Ask-side share 0-100. Absent/null when the print carries no readable aggressor. */
  ask_pct?: number | null;
};

export type SpxTapeSkew = {
  bull: number;
  bear: number;
  /** Premium whose direction could not be read. Never folded into either side. */
  unreadable: number;
};

/**
 * Bucket a tape window's premium three ways. `neutral`-side items (dark-pool prints) are not
 * directional and are excluded entirely rather than counted as unreadable — they are not a
 * failed read, they are a different kind of row.
 */
export function spxTapeSkew(items: readonly SpxTapeDirectionInput[]): SpxTapeSkew {
  const out: SpxTapeSkew = { bull: 0, bear: 0, unreadable: 0 };
  for (const t of items) {
    if (t.side !== "call" && t.side !== "put") continue;
    // ISSUE-35 guard retained: a null premium from the DB arrives typed as number and would
    // turn every subsequent sum into NaN.
    const premium = Number(t.premium);
    if (!Number.isFinite(premium) || premium <= 0) continue;
    const dir = flowDirection({
      option_type: t.side === "put" ? "PUT" : "CALL",
      ask_pct: t.ask_pct ?? null,
    });
    if (dir === "bullish") out.bull += premium;
    else if (dir === "bearish") out.bear += premium;
    else out.unreadable += premium;
  }
  return out;
}

/** Minimum readable notional before the tape is allowed to claim a direction at all. */
export const SPX_TAPE_MIN_NOTIONAL = 250_000;
/** Margin one side must lead by. Unchanged from the shipped factor. */
export const SPX_TAPE_LEAD_RATIO = 1.25;

export type SpxTapeVerdict =
  | { verdict: "bullish" | "bearish"; reason: null }
  /** No direction, and WHY — so the desk can say "can't read it" rather than show nothing. */
  | { verdict: "none"; reason: "thin" | "unreadable" | "balanced" };

/**
 * The tape factor's verdict. Order matters: thinness is checked on the READABLE notional, so a
 * window that is large but unreadable reports `unreadable` (an absence of evidence) rather than
 * `thin` (an absence of flow) — those are different facts about the tape and the detail line
 * shown to the member says which.
 */
export function spxTapeVerdict(skew: SpxTapeSkew): SpxTapeVerdict {
  const readable = skew.bull + skew.bear;
  if (skew.unreadable > readable) return { verdict: "none", reason: "unreadable" };
  if (readable <= SPX_TAPE_MIN_NOTIONAL) return { verdict: "none", reason: "thin" };
  if (skew.bull > skew.bear * SPX_TAPE_LEAD_RATIO) return { verdict: "bullish", reason: null };
  if (skew.bear > skew.bull * SPX_TAPE_LEAD_RATIO) return { verdict: "bearish", reason: null };
  return { verdict: "none", reason: "balanced" };
}

/**
 * The same rule for a raw flow-brief list rather than a built tape — the SPX lotto catalyst reads
 * `desk.spx_flows` directly. It exists so the catalyst and the confluence tape factor cannot drift
 * into calling the same prints different directions; the catalyst keeps its own floor and lead
 * ratio, which are its to choose, but not its own definition of "bullish".
 *
 * UNKNOWN/typeless prints DROP rather than fall into either side — parser-truth from
 * `parseUwFlowAlert`, which emits `option_type: "UNKNOWN"` instead of defaulting to CALL. Counting
 * them as bearish produced false SHORT lotto signals. They are not `unreadable` either: a print
 * with no option type is not a print whose aggressor we failed to read, so it is excluded from the
 * majority test entirely.
 */
export function spxFlowSkew(
  flows: readonly { option_type: string; premium: number; ask_pct?: number | null }[]
): SpxTapeSkew {
  return spxTapeSkew(
    flows.flatMap((f) => {
      const opt = String(f.option_type ?? "").toUpperCase();
      const side = opt.startsWith("C") ? "call" : opt.startsWith("P") ? "put" : null;
      if (!side) return [];
      return [{ side, premium: f.premium, ask_pct: f.ask_pct }];
    })
  );
}
