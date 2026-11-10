/** Dispatch RTH cache warmers before deep audit (avoids false GEX-cold P0 post-rollout). */

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {{ base: string, cron: string, fetchFn?: typeof fetch, waitMs?: number }} args
 */
export async function warmRthAuditCaches({ base, cron, fetchFn = fetch, waitMs = 10_000 }) {
  const headers = { Authorization: `Bearer ${cron}` };
  const paths = ["/api/cron/heatmap-warm?force=1", "/api/cron/desk-warm?force=1"];
  for (const path of paths) {
    try {
      const res = await fetchFn(`${base}${path}`, {
        headers,
        signal: AbortSignal.timeout(180_000),
      });
      await res.json().catch(() => ({}));
      console.log(`  … prewarm ${path} → HTTP ${res.status}`);
    } catch (err) {
      console.warn(`  … prewarm ${path} failed: ${err?.message ?? err}`);
    }
  }
  if (waitMs > 0) await sleep(waitMs);
}
