/** Fargate On-Demand vCPU quota (L-3032A538). Keep in sync with ecs-deploy-config.test.ts */
export const VCPU_QUOTA = 30;
export const WEB_TASK_VCPU = 2;
/** blackout-production-market-worker: 2 tasks × 1 vCPU */
export const WORKER_VCPU = 2;

export function ceilingTasks(desired: number, maximumPercent: number): number {
  return Math.floor((desired * maximumPercent) / 100);
}

/**
 * Smallest maximumPercent that grants a spare task slot under minHealthy=100 for this desiredCount
 * without exceeding the account vCPU quota (web peak + worker).
 */
export function minimumMaximumPercent(
  desired: number,
  opts: { minimumHealthyPercent?: number; vcpuQuota?: number; maxSearch?: number } = {},
): number | null {
  const minimumHealthyPercent = opts.minimumHealthyPercent ?? 100;
  const vcpuQuota = opts.vcpuQuota ?? VCPU_QUOTA;
  const maxSearch = opts.maxSearch ?? 200;
  if (desired <= 0) return null;

  for (let maximumPercent = 120; maximumPercent <= maxSearch; maximumPercent++) {
    const ceiling = ceilingTasks(desired, maximumPercent);
    const canAdd = ceiling > desired;
    const floor =
      minimumHealthyPercent >= 100
        ? desired
        : Math.ceil((desired * minimumHealthyPercent) / 100);
    const canRemove = floor < desired;
    const canProgress = canAdd || canRemove;
    if (minimumHealthyPercent >= 100 && !canAdd) continue;
    if (!canProgress) continue;

    const peakVcpu = ceiling * WEB_TASK_VCPU + WORKER_VCPU;
    if (peakVcpu > vcpuQuota) continue;
    return maximumPercent;
  }
  return null;
}
