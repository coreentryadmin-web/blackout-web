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

/** Pick the honest recap-only reason at the publish-gate exit. */
export function recapReasonAtPublishExit(
  blocked: Array<{ ticker: string; result: { blocks: Array<{ code: string }> } }>,
  funnel: Partial<EditionFunnelCounts>
): string {
  if (blocked.length === 0) {
    return synthesisEmptyRecapReason(funnel);
  }
  return publishGateBlockedRecapReason(blocked);
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
