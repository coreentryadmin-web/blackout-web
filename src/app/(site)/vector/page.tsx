import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { ComingSoon } from "@/components/ComingSoon";
import { VectorPageShell } from "@/components/vector/VectorPageShell";
import type { VectorBar } from "@/components/vector/VectorChart";
import { fetchIndexMinuteBars } from "@/lib/providers/polygon";
import { priorEtYmd, todayEtYmd } from "@/lib/providers/spx-session";
import { pickSessionBars } from "@/lib/providers/vector-initial-bars";

export const metadata: Metadata = {
  title: "Vector · BlackOut",
  description: "Live SPX price action with real-time dark-pool, flow, and GEX level overlays.",
};

/**
 * Today's ET session has no bars at all for a large chunk of every calendar day — anytime
 * before ~4am ET premarket — and /vector is reachable 24/7. Falling through to an empty
 * `initialBars` renders a totally void canvas: no candles, no axes, no "market closed"
 * messaging (reported live as a blank chart with no explanation). Fetch a 5-day lookback as a
 * fallback (comfortably spans a 3-day holiday weekend) only when today has nothing yet, and let
 * `pickSessionBars` reduce it to the single latest prior session.
 */
async function readInitialBars(): Promise<VectorBar[]> {
  const today = todayEtYmd();
  const todayBars = await fetchIndexMinuteBars("I:SPX", today, today).catch(() => []);
  const fallbackBars = todayBars.length > 0 ? [] : await fetchIndexMinuteBars("I:SPX", priorEtYmd(5), today).catch(() => []);
  return pickSessionBars(todayBars, fallbackBars);
}

export default async function VectorPage() {
  await requireTier("premium");
  if (!(await canAccessTool("vector"))) return <ComingSoon toolKey="vector" />;

  const initialBars = await readInitialBars();

  return <VectorPageShell initialBars={initialBars} />;
}
