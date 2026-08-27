// Pure evaluation helpers for vector-gesture-perf-guard.mjs — no network, no browser, unit-testable.
//
// WHY THIS EXISTS: the wall-rail perf bug (2026-08-27, PR #2939) was found by a one-off CDP CPU
// profile during a scripted gesture, not by any committed check — nothing would have caught it
// regressing back in. This turns that same measurement into a real gate: aggregate self-time by
// function across a `.cpuprofile`-shaped { nodes, samples } object and fail when one function's
// share of all samples crosses a threshold, the same signature the original bug had (31% of all
// samples in one function during a zoom/drag burst).

/**
 * Aggregate raw CDP profile samples into per-function self-time shares.
 * `profile.samples` is an array of node ids (one per sampling tick); `profile.nodes` is the node
 * table. Functions are grouped by (functionName, url) — NOT raw node id — because the same named
 * function can appear as multiple distinct call-tree nodes at different call sites, and a real
 * regression's cost is the SUM across all of them, not any single site.
 */
export function computeFunctionShares(profile) {
  const nodes = profile?.nodes ?? [];
  const samples = profile?.samples ?? [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const counts = new Map();
  for (const sampleNodeId of samples) {
    const node = nodeById.get(sampleNodeId);
    if (!node) continue;
    const cf = node.callFrame ?? {};
    const key = `${cf.functionName || "(anonymous)"}|${cf.url || ""}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = samples.length;
  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      count,
      sharePct: total > 0 ? (100 * count) / total : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Guard verdict: does any single function (after excluding known-benign buckets like the idle/GC
 * pseudo-frames) exceed `maxSharePct` of all samples during the gesture?
 *
 * `ignoreKeys` defaults to the CDP pseudo-frames that are not real application/library code and
 * should never fail this guard on their own — a browser truly idle for most of the window is the
 * OPPOSITE of the bug this guards against.
 */
const DEFAULT_IGNORE_KEYS = ["(idle)|", "(program)|", "(garbage collector)|"];

export function evaluateGesturePerfGuard(profile, opts = {}) {
  const maxSharePct = opts.maxSharePct ?? 15;
  const ignoreKeys = opts.ignoreKeys ?? DEFAULT_IGNORE_KEYS;
  const totalSamples = profile?.samples?.length ?? 0;
  if (totalSamples === 0) {
    return { pass: false, reason: "no samples captured — the profiler likely never attached", hottest: null, shares: [], totalSamples: 0 };
  }
  const shares = computeFunctionShares(profile).filter((s) => !ignoreKeys.includes(s.key));
  const hottest = shares[0] ?? null;
  const pass = !hottest || hottest.sharePct <= maxSharePct;
  return {
    pass,
    reason: pass
      ? null
      : `${hottest.key} consumed ${hottest.sharePct.toFixed(1)}% of all samples (cap ${maxSharePct}%)`,
    hottest,
    shares: shares.slice(0, 10),
    totalSamples,
  };
}
