import { runEngagementSweep, type EngageStats } from "@/lib/x-engage-engine";
import { xMarketingSilentOnly } from "@/lib/x-marketing-env";

/** Scheduled growth pass — likes/follows; quote/reply unless X_GROWTH_SILENT_ONLY=1. */
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
