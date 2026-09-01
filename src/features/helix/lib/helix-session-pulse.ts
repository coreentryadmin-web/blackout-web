import type { FlowAlert } from "@/lib/api";
import { directionalPremium, directionLabel } from "@/features/helix/lib/helix-flow-aggression";
import { flowTimeMs } from "@/features/helix/lib/helix-flow-format";
import { WHALE_PRINT_PREMIUM } from "@/features/helix/lib/helix-flow-limits";
import { positionIntent } from "@/features/helix/lib/helix-position-intent";

export type HelixSessionPulse = {
  printCount: number;
  callPremium: number;
  putPremium: number;
  netPremium: number;
  bullishPremium: number;
  bearishPremium: number;
  undeterminedPremium: number;
  directionRead: ReturnType<typeof directionLabel>;
  whaleCount: number;
  openingCount: number;
  printsLast15m: number;
  topTicker: { ticker: string; premium: number } | null;
};

const FIFTEEN_MIN_MS = 15 * 60_000;

/** Session-level tape stats for the pulse bar — pure, no I/O. */
export function computeHelixSessionPulse(
  flows: ReadonlyArray<FlowAlert>,
  nowMs: number = Date.now()
): HelixSessionPulse {
  let callPremium = 0;
  let putPremium = 0;
  let whaleCount = 0;
  let openingCount = 0;
  let printsLast15m = 0;
  const byTicker = new Map<string, number>();

  for (const f of flows) {
    const premium = Number(f.premium);
    if (!Number.isFinite(premium) || premium <= 0) continue;

    if (f.option_type === "CALL") callPremium += premium;
    else if (f.option_type === "PUT") putPremium += premium;

    if (premium >= WHALE_PRINT_PREMIUM) whaleCount += 1;

    if (positionIntent(f).intent === "opening") openingCount += 1;

    const t = flowTimeMs(f);
    if (t != null && nowMs - t <= FIFTEEN_MIN_MS) printsLast15m += 1;

    const ticker = String(f.ticker ?? "").toUpperCase();
    if (ticker) byTicker.set(ticker, (byTicker.get(ticker) ?? 0) + premium);
  }

  const dir = directionalPremium(flows);
  let topTicker: { ticker: string; premium: number } | null = null;
  for (const [ticker, premium] of byTicker) {
    if (!topTicker || premium > topTicker.premium) topTicker = { ticker, premium };
  }

  return {
    printCount: flows.length,
    callPremium,
    putPremium,
    netPremium: callPremium - putPremium,
    bullishPremium: dir.bullish,
    bearishPremium: dir.bearish,
    undeterminedPremium: dir.undetermined,
    directionRead: directionLabel(dir),
    whaleCount,
    openingCount,
    printsLast15m,
    topTicker,
  };
}
