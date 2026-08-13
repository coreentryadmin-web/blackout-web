/**
 * Post-verdict desk actions — deep links derived from envelope + compare card, not model prose.
 */

import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import type { LargoCompareCard } from "@/lib/largo/helix-thermal-compare";
import { DESK_ROUTES } from "@/lib/largo/core/drilldown";

export type LargoAction = {
  id: string;
  label: string;
  href: string;
};

export function buildLargoActions(input: {
  ticker?: string | null;
  envelope?: BieAnswerEnvelope | null;
  compareCard?: LargoCompareCard | null;
}): LargoAction[] {
  const t = (input.ticker ?? "SPX").toString().trim().toUpperCase();
  const flipLevel = input.envelope?.levels?.find((l) => /flip/i.test(String(l.label ?? "")));
  const helixFlip =
    input.compareCard?.kind === "helix_thermal" ? input.compareCard.thermal.flip : null;
  const peerFirstFlip =
    input.compareCard?.kind === "peer_tickers"
      ? input.compareCard.rows.find((r) => r.ticker === t)?.gamma.flip ??
        input.compareCard.rows[0]?.gamma.flip ??
        null
      : null;
  const flip =
    helixFlip ??
    peerFirstFlip ??
    (flipLevel && typeof flipLevel.price === "number" ? flipLevel.price : null);
  const out: LargoAction[] = [];

  if (flip != null && Number.isFinite(Number(flip))) {
    out.push({
      id: "thermal-flip",
      label: `Open Thermal at ${flip}`,
      href: `${DESK_ROUTES.heatmap.path}?ticker=${encodeURIComponent(t)}&strike=${encodeURIComponent(String(flip))}`,
    });
  }

  out.push({
    id: "helix-ticker",
    label: `HELIX — ${t}`,
    href: `${DESK_ROUTES.flows.path}?ticker=${encodeURIComponent(t)}`,
  });

  out.push({
    id: "thermal-ticker",
    label: `Thermal — ${t}`,
    href: `${DESK_ROUTES.heatmap.path}?ticker=${encodeURIComponent(t)}`,
  });

  if (input.envelope?.tradeDecision || /0dte|play|board/i.test(input.envelope?.headline ?? "")) {
    out.push({
      id: "nighthawk",
      label: "0DTE board",
      href: DESK_ROUTES.nighthawk.path,
    });
  }

  out.push({
    id: "watchlist",
    label: `Remember ${t}`,
    href: `#watchlist:${t}`,
  });

  return out.slice(0, 5);
}
