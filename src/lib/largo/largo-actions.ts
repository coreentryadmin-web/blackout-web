/**
 * Post-verdict desk actions — deep links derived from envelope + compare card, not model prose.
 */

import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import type { HelixThermalCompareCard } from "@/lib/largo/helix-thermal-compare";
import { DESK_ROUTES } from "@/lib/largo/core/drilldown";

export type LargoAction = {
  id: string;
  label: string;
  href: string;
};

export function buildLargoActions(input: {
  ticker?: string | null;
  envelope?: BieAnswerEnvelope | null;
  compareCard?: HelixThermalCompareCard | null;
}): LargoAction[] {
  const t = (input.ticker ?? "SPX").toString().trim().toUpperCase();
  const flipLevel = input.envelope?.levels?.find((l) => /flip/i.test(String(l.label ?? "")));
  const flip =
    input.compareCard?.thermal.flip ??
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
