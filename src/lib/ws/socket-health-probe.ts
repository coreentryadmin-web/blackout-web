/**
 * Wait for cluster UW delivery or local leader auth after socket boot.
 * Cron probes often hit a non-leader replica — local channels stay CLOSED by design.
 */

import { probeClusterSocketHealth } from "@/lib/ws/cluster-socket-probe";
import { getUwSocketHealth } from "@/lib/ws/uw-socket";
import { uwConfigured } from "@/lib/providers/config";
import { inOptionsMarketHours } from "@/lib/ws/options-socket";

function localUwLive(): boolean {
  if (!uwConfigured()) return true;
  const uw = getUwSocketHealth();
  if (uw.auth_failed) return false;
  const channels = uw.channels ?? {};
  return Object.values(channels).some(
    (ch) =>
      ch &&
      typeof ch === "object" &&
      (ch as { ws_state?: string; authenticated?: boolean }).ws_state === "OPEN" &&
      (ch as { authenticated?: boolean }).authenticated === true
  );
}

/** Poll Redis leader heartbeat (and local leader) during RTH socket boot. */
export async function waitForClusterSocketWarmth(maxMs = 20_000): Promise<{
  ok: boolean;
  cluster: Awaited<ReturnType<typeof probeClusterSocketHealth>>;
  waited_ms: number;
}> {
  const started = Date.now();
  let cluster = await probeClusterSocketHealth();

  while (Date.now() - started < maxMs) {
    if (cluster.ok || localUwLive()) {
      return { ok: true, cluster, waited_ms: Date.now() - started };
    }
    await new Promise((r) => setTimeout(r, 2_000));
    cluster = await probeClusterSocketHealth();
  }

  return {
    ok: cluster.ok || localUwLive(),
    cluster,
    waited_ms: Date.now() - started,
  };
}

export function socketHealthOkDuringRth(
  cluster: Awaited<ReturnType<typeof probeClusterSocketHealth>>,
  localOptionsOk: boolean,
  localLuldOk: boolean
): boolean {
  if (!inOptionsMarketHours()) {
    return localOptionsOk && localLuldOk;
  }
  if (cluster.ok) return localOptionsOk && localLuldOk;
  return localUwLive() && localOptionsOk && localLuldOk;
}
