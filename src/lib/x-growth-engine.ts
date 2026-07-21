import { runEngagementSweep, type EngageStats } from "@/lib/x-engage-engine";
import { xMarketingSilentOnly } from "@/lib/x-marketing-env";

/** Scheduled growth pass — PPU: likes/follows; Enterprise: + FinTwit quote/reply. */
export async function runGrowthSweep(opts: {
  dryRun?: boolean;
  cronMode?: boolean;
  silentOnly?: boolean;
}): Promise<EngageStats> {
  return runEngagementSweep({
    dryRun: opts.dryRun,
    cronMode: opts.cronMode ?? true,
    silentOnly: opts.silentOnly ?? xMarketingSilentOnly(),
  });
}
