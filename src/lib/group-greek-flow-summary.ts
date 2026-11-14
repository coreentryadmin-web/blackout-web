function num(row: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = row[k];
    if (v != null && Number.isFinite(Number(v))) return Number(v);
  }
  return 0;
}

/**
 * Like num(), but also reports whether ANY of the keys was actually present on the row.
 *
 * UW's group-flow greek-flow endpoint (`/api/group-flow/{group}/greek-flow`) carries no gamma
 * field at all — confirmed live 2026-08-29/09-02, real mag7 rows only ever carry delta/vega/premium
 * keys (`dir_delta_flow`, `total_delta_flow`, `net_call_premium`, etc.), never `net_gamma`/`gamma`/
 * `gex`/`net_gex`. Without this distinction, an all-absent gamma column silently accumulates to 0,
 * which reads as "measured, dealer gamma flat" instead of "this data source cannot calibrate
 * gamma" — the same fabricated-certainty failure the Largo product contract's `confidence`
 * omission rule exists to prevent. Omission is honest; a fabricated 0 is not.
 */
function numPresent(row: Record<string, unknown>, ...keys: string[]): { value: number; present: boolean } {
  for (const k of keys) {
    const v = row[k];
    if (v != null && Number.isFinite(Number(v))) return { value: Number(v), present: true };
  }
  return { value: 0, present: false };
}

export type GroupGreekFlowSummary = {
  group: string;
  net_delta: number;
  /** null when this data source carries no gamma field at all — never a fabricated 0. */
  net_gamma: number | null;
  call_delta: number;
  put_delta: number;
  bias: "supportive" | "opposing" | "neutral";
  headline: string;
  row_count: number;
};

/** Aggregate UW group-flow greek-flow rows into macro dealer positioning context. */
export function summarizeGroupGreekFlow(
  group: string,
  rows: Record<string, unknown>[]
): GroupGreekFlowSummary | null {
  if (!rows.length) return null;

  let netDelta = 0;
  let netGamma = 0;
  let gammaPresent = false;
  let callDelta = 0;
  let putDelta = 0;

  for (const r of rows) {
    // dir_delta_flow is UW's real (signed, "directional") net-delta field on this endpoint —
    // net_delta/delta/net_deltas are kept first for any other caller/fixture shape that already
    // uses those names. total_delta_flow is deliberately NOT used as a delta source: it is a
    // magnitude/activity sum (always larger, not signed), confirmed against the same live sample
    // (dir_delta_flow ~308K vs total_delta_flow ~1.58M on the same row) — using it as "net" would
    // misrepresent both the magnitude and, on some rows, the sign.
    const rowNetDelta = num(r, "net_delta", "delta", "net_deltas", "dir_delta_flow");
    const rowCallDelta = num(r, "call_delta", "call_deltas");
    const rowPutDelta = num(r, "put_delta", "put_deltas");
    const rowGamma = numPresent(r, "net_gamma", "gamma", "net_gex", "gex");

    netDelta += rowNetDelta !== 0 ? rowNetDelta : rowCallDelta + rowPutDelta;
    if (rowGamma.present) {
      gammaPresent = true;
      netGamma += rowGamma.value;
    }
    callDelta += rowCallDelta;
    putDelta += rowPutDelta;
  }

  const netGammaResult: number | null = gammaPresent ? netGamma : null;

  if (netDelta === 0 && netGammaResult === null) return null;

  const bias: GroupGreekFlowSummary["bias"] =
    netDelta > 50_000 || (netGammaResult != null && netGammaResult > 0)
      ? "supportive"
      : netDelta < -50_000 || (netGammaResult != null && netGammaResult < 0)
        ? "opposing"
        : "neutral";

  const groupLabel = group.toUpperCase() === "MAG7" ? "Mag7" : group;
  const absDelta = Math.abs(netDelta);
  // A value that ROUNDS to 1000 of the K unit belongs in the next unit up, not a four-digit
  // overflowed label (e.g. 999_600 must read "1.00M", never "1000K") — the `absDelta >= 1_000_000`
  // check alone runs BEFORE rounding, so without this second check the K branch can round past
  // its own unit boundary. Same round-first-then-promote fix already applied to fmt-money.ts's
  // fmtPremium, thermal-discord-card.ts's fmtCompactHeatMoney, darkpool-discord-format.ts's
  // fmtShares, discord-context-enrichment.ts's formatAdvShareLabel, and helix-flow-format.ts's
  // fmtOi — this formatter never got it.
  const deltaM =
    absDelta >= 1_000_000 || Math.round(absDelta / 1000) >= 1000
      ? `${(netDelta / 1_000_000).toFixed(2)}M`
      : `${Math.round(netDelta / 1000)}K`;
  // "dealer gamma ..." is only said when gamma was actually measured on this data source —
  // this endpoint never carries it, so the headline says "dealer delta flow" instead rather than
  // claiming a gamma read that was never made.
  const gammaWord = netGammaResult != null ? "gamma" : "delta flow";
  // BUG FIX (round 531): `bias` above is driven by delta OR gamma (either signal alone can decide
  // it — e.g. gamma>0 forces "supportive" even when delta itself is negative), but the headline
  // UNCONDITIONALLY quoted the raw delta figure next to that label regardless of which signal
  // actually decided it. Whenever gamma was the deciding signal and delta's own sign disagreed,
  // this produced a literally self-contradictory sentence — live-reproducible with any gamma-
  // bearing group (e.g. a sector group, unlike mag7 which this endpoint never carries gamma for):
  // net_delta=-45_000 (bearish on its own) + net_gamma=+80_000 (bullish, and >50K's only tie-
  // breaker) rendered "semis dealer gamma supportive — net -45K delta" — "supportive" stated
  // flatly next to an explicit negative delta figure, with nothing telling the reader the two
  // signals disagree. The Largo product contract's own rule is "disagreement is represented,
  // never reconciled by the lanes themselves" (docs/audit/LARGO-PRODUCT-CONTRACT.md) — silently
  // printing the dissenting number as if it were confirming evidence is the opposite of that:
  // it HIDES the disagreement inside a sentence that reads as agreement.
  // Fix: detect when the quoted delta figure's own sign contradicts the stated bias (only
  // possible when gamma — not delta — decided it) and say so explicitly instead of presenting
  // the two numbers as agreeing.
  const deltaDisagrees =
    netGammaResult != null &&
    ((bias === "supportive" && netDelta < 0) || (bias === "opposing" && netDelta > 0));
  const deltaClause = deltaDisagrees ? `delta flow disagrees (net ${deltaM})` : `net ${deltaM} delta`;
  const headline =
    bias === "supportive"
      ? `${groupLabel} dealer ${gammaWord} supportive — ${deltaClause}`
      : bias === "opposing"
        ? `${groupLabel} dealer ${gammaWord} opposing — ${deltaClause}`
        : `${groupLabel} dealer greek flow neutral`;

  return {
    group,
    net_delta: netDelta,
    net_gamma: netGammaResult,
    call_delta: callDelta,
    put_delta: putDelta,
    bias,
    headline,
    row_count: rows.length,
  };
}
