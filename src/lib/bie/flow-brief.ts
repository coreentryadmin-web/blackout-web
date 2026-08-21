import type { FlowAlert } from "@/lib/api";
import { WHALE_PRINT_PREMIUM } from "@/features/helix/lib/helix-flow-limits";
import { fmtPremium } from "@/lib/fmt-money";

type DarkBlock = {
  ticker: string;
  premium: number;
  side: string;
  share_size?: number;
};

/** Deterministic HELIX flow memo — same inputs the Claude path used, no LLM. */
export function composeFlowBrief(alerts: FlowAlert[], darkPrints: DarkBlock[]): string | null {
  if (!alerts.length) return null;

  const callPrem = alerts.filter((a) => a.option_type === "CALL").reduce((s, a) => s + a.premium, 0);
  const putPrem = alerts.filter((a) => a.option_type === "PUT").reduce((s, a) => s + a.premium, 0);
  const total = callPrem + putPrem;
  // null, not 50 — same defect class fixed on get_helix_tape_analytics. A tape with no
  // measurable call/put premium (empty, or every print typeless) is not a balanced tape, and
  // this memo is member-visible via /api/market/flow-brief and the /flows FlowBrief panel.
  const callPct = total > 0 ? Math.round((callPrem / total) * 100) : null;
  const whales = alerts.filter((a) => a.premium >= WHALE_PRINT_PREMIUM).length;

  const massiveFlow = alerts
    .filter((a) => a.premium >= 15_000_000)
    .sort((a, b) => b.premium - a.premium)[0];
  const massiveDark = darkPrints
    .filter((d) => d.premium >= 15_000_000)
    .sort((a, b) => b.premium - a.premium)[0];

  const parts: string[] = [];
  if (massiveDark) {
    parts.push(
      `${massiveDark.ticker} ${massiveDark.side.toUpperCase()} dark pool ${fmtPremium(massiveDark.premium)}`
    );
  }
  if (massiveFlow) {
    parts.push(
      `${massiveFlow.ticker} ${massiveFlow.option_type} ${massiveFlow.route} ${fmtPremium(massiveFlow.premium)}`
    );
  }

  // "mixed" is a MEASURED verdict — it says the tape was read and came back balanced. With no
  // measurable premium there is no verdict to give, so the memo says so instead of picking one.
  const bias = callPct == null ? null : callPct >= 58 ? "call-led" : callPct <= 42 ? "put-led" : "mixed";
  const lead =
    parts.length > 0
      ? `${parts.join(" · ")} anchor the tape.`
      : callPct != null
        ? `${alerts.length} prints · ${callPct}% call premium.`
        : `${alerts.length} prints · call/put premium not measured.`;

  // Without this branch an all-typeless tape read: "N prints · 50% call premium. Flow is mixed
  // ($0 notional, 1 whale prints >$1M)" — a balanced verdict, zero notional and a whale, all at
  // once. The whale count is real (it does not depend on side); the skew is not.
  const tail =
    bias != null
      ? ` Flow is ${bias} (${fmtPremium(total)} notional, ${whales} whale prints >$1M).`
      : ` Side unknown on every print (${whales} whale prints >$1M).`;

  return `${lead}${tail}`;
}
