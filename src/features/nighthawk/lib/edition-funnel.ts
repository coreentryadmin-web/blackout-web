/** Funnel counts + recap-only reason helpers (pure — safe to unit-test). */

export type EditionFunnelCounts = {
  candidates: number;
  ranked: number;
  governor_passed?: number;
  posture_applied?: number;
  dossiers: number;
  synthesized: number;
  critic_passed: number;
  published: number;
  grounded?: number;
  dropped_ungrounded?: number;
  flagged?: number;
};

/** Compact funnel line for recap_only_reason and member-facing meta.funnel. */
export function formatEditionFunnelSummary(f: Partial<EditionFunnelCounts>): string {
  const n = (v: number | undefined) => (v == null ? "?" : String(v));
  return (
    `candidates=${n(f.candidates)} ranked=${n(f.ranked)} dossiers=${n(f.dossiers)} ` +
    `synthesized=${n(f.synthesized)} critic=${n(f.critic_passed)} ` +
    `grounded=${n(f.grounded)} dropped_ungrounded=${n(f.dropped_ungrounded)} published=${n(f.published)}`
  );
}

/** Recap reason when publish gates ran but nothing entered them (synthesis/critic/backfill zero). */
export function synthesisEmptyRecapReason(funnel: Partial<EditionFunnelCounts>): string {
  return (
    `Synthesis produced zero plays before publish gates — funnel: ${formatEditionFunnelSummary(funnel)}.`
  );
}

/** Recap reason when gates blocked every play that reached them. */
export function publishGateBlockedRecapReason(
  blocked: Array<{ ticker: string; result: { blocks: Array<{ code: string }> } }>
): string {
  const detail = blocked
    .map((b) => `${b.ticker}: ${b.result.blocks.map((x) => x.code).join(",")}`)
    .join("; ");
  return `Publish gates blocked all ${blocked.length} play(s) (${detail}) — zero honest plays beats an unfillable pick.`;
}

/** Minimal shape this module needs from the Night Hawk 0DTE scan heartbeat
 *  (see `loadZeroDteScanHeartbeat`/`getZeroDteScanHeartbeat` in
 *  `@/lib/play-engine-heartbeat`) — kept structural rather than importing the
 *  DB-backed module directly so this file stays pure/DB-free and unit-testable
 *  with plain object literals. */
export type ZeroDteScanHeartbeatLike = {
  stale: boolean;
  critical_stale: boolean;
  age_ms: number | null;
};

/** NH-R10: recap reason when the board is empty AND the upstream 0DTE scan
 *  cycle itself has gone stale/silent — distinct from "gates blocked everything"
 *  (data reached the pipeline, judged unfillable) and "synthesis empty"
 *  (data reached synthesis, produced nothing) because here the upstream feed
 *  never handed synthesis fresh data to begin with. Ops needs to be able to
 *  tell "genuinely quiet market" apart from "cold/broken upstream feed"
 *  without cross-referencing a second dashboard. */
export function engineStalledRecapReason(heartbeat: ZeroDteScanHeartbeatLike): string {
  const ageSec = heartbeat.age_ms != null ? Math.round(heartbeat.age_ms / 1000) : null;
  const ageText = ageSec != null ? `${ageSec}s` : "unknown";
  const severity = heartbeat.critical_stale ? "CRITICAL" : "stale";
  return (
    `0DTE scan heartbeat is ${severity} (last tick ${ageText} ago) — recap-only reflects a ` +
    `possibly-stalled upstream feed, not a confirmed quiet market. Check the scan cron.`
  );
}

/** Pick the honest recap-only reason at the publish-gate exit.
 *
 *  `heartbeat` is optional so every existing non-heartbeat-aware caller keeps
 *  working unchanged; when supplied and stale/critical_stale, it takes
 *  precedence over both the gate-blocked and synthesis-empty wordings — an
 *  empty board while the upstream scan itself is silent is a different failure
 *  mode than either of those and must not be misreported as "quiet market". */
export function recapReasonAtPublishExit(
  blocked: Array<{ ticker: string; result: { blocks: Array<{ code: string }> } }>,
  funnel: Partial<EditionFunnelCounts>,
  heartbeat?: ZeroDteScanHeartbeatLike | null
): string {
  if (heartbeat && (heartbeat.stale || heartbeat.critical_stale)) {
    return engineStalledRecapReason(heartbeat);
  }
  if (blocked.length === 0) {
    return synthesisEmptyRecapReason(funnel);
  }
  return publishGateBlockedRecapReason(blocked);
}

/** Minimal shape this module needs from `MarketWideContext`'s per-discovery-lane fetch-failure
 *  flags (kept structural, not importing market-wide.ts directly, so this file stays pure/
 *  dependency-free and unit-testable with plain object literals — same reasoning as
 *  `ZeroDteScanHeartbeatLike` above). Each flag is true ONLY when that lane's own upstream fetch
 *  threw, never on a legitimate empty/thin result. */
export type DiscoveryLaneFetchFailures = {
  flow_fetch_failed?: boolean;
  oi_change_fetch_failed?: boolean;
  unusual_trades_fetch_failed?: boolean;
  catalyst_fetch_failed?: boolean;
  predictions_fetch_failed?: boolean;
  movers_fetch_failed?: boolean;
  breakout_fetch_failed?: boolean;
};

/** Ordered [lane name, flag] pairs — the single place that enumerates the 7 discovery lanes'
 *  fetch-failure flags, so `anyDiscoveryLaneFetchFailed`/`failedDiscoveryLaneNames` can never
 *  drift out of sync with each other. Lane names match `extractMultiSourceCandidates`'s own
 *  `lanes` array (candidates.ts) exactly. */
function discoveryLaneFailurePairs(
  flags: DiscoveryLaneFetchFailures | undefined | null
): Array<[string, boolean | undefined]> {
  if (!flags) return [];
  return [
    ["flow", flags.flow_fetch_failed],
    ["oi_change", flags.oi_change_fetch_failed],
    ["unusual_trades", flags.unusual_trades_fetch_failed],
    ["catalyst", flags.catalyst_fetch_failed],
    ["predictions", flags.predictions_fetch_failed],
    ["movers", flags.movers_fetch_failed],
    ["breakout", flags.breakout_fetch_failed],
  ];
}

/** True when ANY of the 7 discovery lanes' own upstream fetch threw (vs legitimately returning
 *  zero/few rows). Audit finding (2026-11-09): previously only `flow_fetch_failed` was checked
 *  (`alertRecapOnlyIfAnomalous`'s old `benign` test), so a genuine provider outage on any of the
 *  other 6 lanes (OI change, unusual trades, catalyst/Benzinga, predictions, movers, breakout) —
 *  flow itself still succeeding — was silently classified as an honestly quiet market and never
 *  paged ops. */
export function anyDiscoveryLaneFetchFailed(flags: DiscoveryLaneFetchFailures | undefined | null): boolean {
  return discoveryLaneFailurePairs(flags).some(([, failed]) => Boolean(failed));
}

/** Names of the lanes whose fetch failed (e.g. `["catalyst", "movers"]`), for an ops alert body —
 *  so a page says WHICH lane broke, not just that something did. Empty when none failed. */
export function failedDiscoveryLaneNames(flags: DiscoveryLaneFetchFailures | undefined | null): string[] {
  return discoveryLaneFailurePairs(flags)
    .filter(([, failed]) => failed)
    .map(([name]) => name);
}

/** Display name for each lane, matching the wording `zeroCandidatesRecapReason`'s own count
 *  enumeration already uses (e.g. the `oi_change` flag names the lane "OI" there, not
 *  "oi_change") — kept as its own small table so the disclosure clause and the count line never
 *  describe the same lane two different ways. */
const LANE_DISPLAY_NAMES: Record<string, string> = {
  flow: "flows",
  oi_change: "OI",
  unusual_trades: "unusual",
  catalyst: "catalyst",
  predictions: "predictions",
  movers: "movers",
  breakout: "breakout",
};

/** Builds the (possibly empty) fetch-failure disclosure clause appended to
 *  `zeroCandidatesRecapReason`'s output. Audit finding (2026-11-09, narrower follow-up to the
 *  6-of-7-lanes-unmonitored fix above): the 7-lane count line this function's sibling renders
 *  names each lane's raw count, but a lane whose fetch genuinely THREW and one that legitimately
 *  found zero rows both render as the same "<lane> 0" — there was no way, reading the reason text
 *  alone (the string a member or Largo's `get_nighthawk_edition` tool actually sees), to tell a
 *  real provider outage apart from an honestly quiet lane. Returns "" when no lane failed, so
 *  callers that omit `failures` (or pass all-false flags) get byte-identical output to before
 *  this clause existed. */
function fetchFailureDisclosureClause(failures: DiscoveryLaneFetchFailures | undefined | null): string {
  const failedLanes = failedDiscoveryLaneNames(failures);
  if (failedLanes.length === 0) return "";
  const displayNames = failedLanes.map((lane) => LANE_DISPLAY_NAMES[lane] ?? lane);
  const plural = displayNames.length > 1;
  return (
    `Note: ${displayNames.join(", ")} data could not be fetched (upstream provider error) — ` +
    `${plural ? "these counts reflect fetch failures" : "this count reflects a fetch failure"}, ` +
    `${plural ? "not confirmed absences" : "not a confirmed absence"}.`
  );
}

/** The zero-candidates recap-only reason, naming all 7 discovery lanes' real counts. Audit
 *  finding (2026-11-09): the previous reason string named only 4 of the 7 lanes (flows, OI,
 *  unusual, movers) — catalyst/predictions/breakout counts never appeared, so even a human
 *  reading the stored `recap_only_reason` could not tell whether those three lanes ran at all.
 *
 *  `failures` is optional (and defaults to no disclosure) so every existing caller keeps working
 *  unchanged; when supplied, any lane whose count is 0 BECAUSE its own fetch threw gets an
 *  explicit disclosure clause appended — see `fetchFailureDisclosureClause` above. This is the
 *  narrower, still-open half of the audit finding this module's header comment on
 *  `DiscoveryLaneFetchFailures` describes: the flags were already computed and already reached
 *  the internal ops-only Discord alert (`alertRecapOnlyIfAnomalous`), but never reached THIS
 *  member/Largo-facing string — a member or Largo reading a recap-only night could not tell
 *  "the market was genuinely dead" apart from "a feed was down and we never actually checked",
 *  a direct violation of `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s absence-must-be-disclosed
 *  principle. */
export function zeroCandidatesRecapReason(
  counts: {
    flows: number;
    oi: number;
    unusual: number;
    catalyst: number;
    predictions: number;
    movers: number;
    breakout: number;
  },
  failures?: DiscoveryLaneFetchFailures | null
): string {
  const base = (
    `No candidates from any source (flows ${counts.flows}, OI ${counts.oi}, ` +
    `unusual ${counts.unusual}, catalyst ${counts.catalyst}, predictions ${counts.predictions}, ` +
    `movers ${counts.movers}, breakout ${counts.breakout}).`
  );
  const disclosure = fetchFailureDisclosureClause(failures);
  return disclosure ? `${base} ${disclosure}` : base;
}

export function funnelFromMeta(meta: Record<string, unknown> | null | undefined): EditionFunnelCounts | null {
  const raw = meta?.funnel;
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const num = (k: keyof EditionFunnelCounts) => {
    const v = f[k];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };
  const candidates = num("candidates");
  const ranked = num("ranked");
  const dossiers = num("dossiers");
  const synthesized = num("synthesized");
  const critic_passed = num("critic_passed");
  const published = num("published");
  if (
    candidates == null &&
    ranked == null &&
    dossiers == null &&
    synthesized == null &&
    critic_passed == null &&
    published == null
  ) {
    return null;
  }
  return {
    candidates: candidates ?? 0,
    ranked: ranked ?? 0,
    governor_passed: num("governor_passed"),
    posture_applied: num("posture_applied"),
    dossiers: dossiers ?? 0,
    synthesized: synthesized ?? 0,
    critic_passed: critic_passed ?? 0,
    published: published ?? 0,
    grounded: num("grounded"),
    dropped_ungrounded: num("dropped_ungrounded"),
    flagged: num("flagged"),
  };
}
