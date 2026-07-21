import { runEngagementSweep, type EngageStats } from "@/lib/x-engage-engine";

/** Scheduled growth pass — likes/follows + quote/reply on followed FinTwit targets. */
export async function runGrowthSweep(opts: {
  dryRun?: boolean;
  cronMode?: boolean;
}): Promise<EngageStats> {
  return runEngagementSweep({
    dryRun: opts.dryRun,
    cronMode: opts.cronMode ?? true,
  });
}
