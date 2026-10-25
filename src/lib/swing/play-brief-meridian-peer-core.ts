/**
 * Pure Meridian peer coaching for swing play brief — no server-only imports.
 */
import type { LargoPeerCohortMember } from "@/lib/largo/meridian-peer-cohort-for-largo-core";
import type { LargoTimelineItem } from "@/lib/largo/meridian-timeline-for-largo";

/** Index/proxy names that use market-wide Meridian catalyst slices — no per-name earnings peer cohort. */
export const SWING_MERIDIAN_INDEX_TICKERS = new Set(["SPX", "SPXW", "SPY", "QQQ", "IWM", "VIX", "NDX"]);

/** Pick the earnings catalyst for peer coaching — ticker-matched; null for index swings or no match. */
export function pickEarningsForSwingPeer(
  items: LargoTimelineItem[] | null | undefined,
  ticker: string,
): LargoTimelineItem | null {
  if (!items?.length) return null;
  const sym = ticker.toUpperCase();
  if (SWING_MERIDIAN_INDEX_TICKERS.has(sym)) return null;
  return (
    items.find(
      (i) =>
        i.kind === "earnings" &&
        i.days_until >= 0 &&
        i.days_until <= 14 &&
        i.ticker?.toUpperCase() === sym,
    ) ?? null
  );
}

/** Peer cohort slice when fetch succeeded — shape matches loadMeridianPeerCohortForLargo success path. */
export type SwingMeridianPeerAvailable = {
  available: true;
  id: string;
  subject_ticker: string;
  position_summary: string | null;
  members: LargoPeerCohortMember[];
  interpretation?: string;
  sector_label?: string | null;
  major_group?: string | null;
  distribution?: unknown;
  insufficient_reason?: string | null;
  timeline_window_days?: number;
};

export type SwingMeridianPeerUnavailable = {
  available: false;
  error?: string;
  note?: string;
};

export type SwingMeridianPeerSlice = SwingMeridianPeerAvailable | SwingMeridianPeerUnavailable;

/**
 * Trailing sizing/hedging instruction this function always appends to a rendered peer-lens
 * bullet. Exported as a literal constant (2026-10-25, Ask Largo standing mandate, live repro
 * OUST 31C) so `meridianPeerSection` (play-brief-intel.ts) can detect and replace it, at the
 * section-assembly layer, for the one case this function itself cannot see: the REVIEWED
 * position's own contract already expiring on/before the print (no earnings-gap exposure from
 * THIS position specifically) — see that call site's own comment (SWING:OUST:2127) for the full
 * contradiction this closes. This function stays pure/play-unaware (it has no `ctx`/`play` to
 * check an expiry against), the same discipline the 2026-10-24 CLOSED-bucket fix already
 * established for this exact function.
 */
export const EARNINGS_PEER_SIZING_INSTRUCTION =
  "Peers that beat often gap through implied — size down or hedge vol unless thesis is the print.";

/** Pure coaching line from peer cohort + catalyst item. */
export function meridianPeerEarningsCoaching(
  peer: SwingMeridianPeerSlice | null | undefined,
  item: LargoTimelineItem | null,
): string | null {
  if (!item || item.kind !== "earnings" || item.days_until > 14) return null;

  const parts: string[] = [];
  if (item.expected_move_pct != null) {
    parts.push(`implied move **${item.expected_move_pct.toFixed(1)}%**`);
  }
  // BUG FIX (2026-10-21, Ask Largo standing mandate, live repro SHOP): this baseline line used to
  // gate on `days_until <= 7` — a narrower sub-window left over from before this function's own
  // entry gate (above) was widened to 14 days. For an item 8-14 days out with no expected_move_pct
  // quoted and an unavailable peer cohort, that left `parts` empty and the WHOLE section silently
  // omitted — while a sibling ticker 7 days out, with the identical unavailable-cohort reason, got
  // the thin "reports in Nd" fallback. Always push the baseline line for any item the function was
  // already entered for (days_until 0-14); `days_until <= 3` still adds the extra urgency bullet.
  parts.push(item.days_until <= 0 ? "reports **today**" : `reports in **${item.days_until}d**`);
  if (item.days_until <= 3) {
    parts.push("**print imminent** — vol crush risk elevated");
  }

  if (peer && peer.available) {
    if (peer.sector_label) parts.push(`sector **${peer.sector_label}**`);
    if (peer.interpretation?.trim()) parts.push(peer.interpretation.trim());
    // BUG FIX (2026-10-21, Ask Largo standing mandate, live repro TSLA): whenever the cohort is
    // thin (distribution === null), describeCohortPosition() (meridian-sector-core.ts) returns
    // `${label} — ${insufficientReason}` for position_summary — the SAME reason string that also
    // lands on insufficient_reason below, verbatim. Pushing both unconditionally stated the
    // identical "no peers reporting..." clause twice in one rendered bullet. position_summary is
    // only worth stating here when it carries a real ranking (distribution present); the thin-
    // cohort case is already covered once, by the insufficient_reason caveat below.
    if (peer.position_summary && peer.distribution) parts.push(peer.position_summary);
    // GAP FOUND (2026-09-21, Ask Largo standing mandate): `shapeMeridianPeerCohortForLargo`
    // (meridian-peer-cohort-for-largo-core.ts) tags the subject ticker's OWN historical print
    // record onto `peer.members` as `is_subject: true` — carrying its own `beat_rate`/
    // `beat_rate_n`/`avg_reaction_pct`, computed by the exact same engine as the three peer
    // rows below. Until now this function filtered it OUT (`!m.is_subject`) and narrated only
    // OTHER tickers' beat rates — a trader deciding whether to hold THIS position through ITS
    // OWN print never saw the one number most directly relevant to that decision (how has this
    // exact ticker behaved on past prints), while three unrelated peers' beat rates rendered
    // instead. Live-verified: no other swing brief section narrates it either (`grep -rn
    // "is_subject" src/lib/swing/*.ts` outside this file returns nothing) — this was a real,
    // silent absence, not a duplicate of something shown elsewhere. Fixed by surfacing the
    // subject's own line FIRST, ahead of peer history, gated on the SAME `beat_rate_n >= 3`
    // sample-size floor peers already require (never fabricate a rate off a thin sample —
    // Largo product contract's absence principle) and independent of whether any peer clears
    // that bar, so a thin peer cohort no longer hides an otherwise well-sampled subject read.
    const subject = (peer.members ?? []).find((m) => m.is_subject);
    if (subject && subject.beat_rate_n >= 3 && subject.beat_rate != null) {
      const beat = `${Math.round(subject.beat_rate * 100)}% beat`;
      const reaction =
        subject.avg_reaction_pct != null && subject.reaction_sample_n > 0
          ? `, avg reaction **${subject.avg_reaction_pct >= 0 ? "+" : ""}${subject.avg_reaction_pct.toFixed(1)}%** (n=${subject.reaction_sample_n})`
          : "";
      parts.push(`**this ticker's own print history: ${beat}** (n=${subject.beat_rate_n})${reaction}`);
    }
    const peers = (peer.members ?? []).filter((m) => !m.is_subject && m.beat_rate_n >= 3);
    if (peers.length) {
      // BUG FIX (2026-10-20, Ask Largo standing mandate — same Largo C3 absence-disclosure shape
      // already fixed today in play-brief-diff.ts/envelopeWithDiffSection and already correctly
      // handled by the sibling meridianCatalystsSection, play-brief-intel.ts). Up to
      // MAX_PEER_REACTION_TICKERS=6 non-subject peers can qualify with beat_rate_n>=3, but only
      // the first 3 were ever shown — silently, with no "+N more" note, so a trader had no way to
      // know the real cohort was larger than the 3 names rendered.
      const PEER_SNIPPET_LIMIT = 3;
      const shown = peers.slice(0, PEER_SNIPPET_LIMIT);
      const snippets = shown
        .map((m) => {
          const beat =
            m.beat_rate != null ? `${Math.round(m.beat_rate * 100)}% beat` : "beat n/a";
          return `**${m.ticker}** ${beat} (n=${m.beat_rate_n})`;
        })
        .join(" · ");
      const overflow = peers.length - shown.length;
      parts.push(
        overflow > 0
          ? `peer history: ${snippets} (+${overflow} more peer${overflow === 1 ? "" : "s"} not shown)`
          : `peer history: ${snippets}`,
      );
    }
    if (peer.insufficient_reason?.trim()) {
      parts.push(
        `_Implied-move cohort thin: ${peer.insufficient_reason.trim()} — peer beat rates are directional only._`,
      );
    }
  }

  if (!parts.length) return null;
  return `**Earnings peer lens** — ${parts.join(" · ")}. ${EARNINGS_PEER_SIZING_INSTRUCTION}`;
}
