/**
 * Pure Meridian peer coaching for swing play brief — no server-only imports.
 */
import type { LargoPeerCohortMember } from "@/lib/largo/meridian-peer-cohort-for-largo-core";
import type { LargoTimelineItem } from "@/lib/largo/meridian-timeline-for-largo";

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
  if (item.days_until <= 7) {
    parts.push(
      item.days_until <= 0 ? "reports **today**" : `reports in **${item.days_until}d**`,
    );
  }
  if (item.days_until <= 3) {
    parts.push("**print imminent** — vol crush risk elevated");
  }

  if (peer && peer.available) {
    if (peer.sector_label) parts.push(`sector **${peer.sector_label}**`);
    if (peer.interpretation?.trim()) parts.push(peer.interpretation.trim());
    if (peer.position_summary) parts.push(peer.position_summary);
    const peers = (peer.members ?? []).filter((m) => !m.is_subject && m.beat_rate_n >= 3);
    if (peers.length) {
      const snippets = peers
        .slice(0, 3)
        .map((m) => {
          const beat =
            m.beat_rate != null ? `${Math.round(m.beat_rate * 100)}% beat` : "beat n/a";
          return `**${m.ticker}** ${beat} (n=${m.beat_rate_n})`;
        })
        .join(" · ");
      parts.push(`peer history: ${snippets}`);
    }
  }

  if (!parts.length) return null;
  return (
    `**Earnings peer lens** — ${parts.join(" · ")}. ` +
    `Peers that beat often gap through implied — size down or hedge vol unless thesis is the print.`
  );
}

/** Structured evidence text for peer beat-rate cohorts (Largo C7). */
export function meridianPeerEvidenceText(
  peer: SwingMeridianPeerSlice | null | undefined,
  item: LargoTimelineItem | null,
): string | null {
  if (!item || item.kind !== "earnings" || item.days_until > 14) return null;
  if (!peer?.available) return null;

  const parts: string[] = [];
  if (peer.sector_label) parts.push(`sector ${peer.sector_label}`);
  if (item.expected_move_pct != null) {
    parts.push(`implied move ${item.expected_move_pct.toFixed(1)}%`);
  }

  const peers = (peer.members ?? []).filter((m) => !m.is_subject && m.beat_rate_n >= 3);
  if (peers.length) {
    const snippets = peers
      .slice(0, 3)
      .map((m) => {
        const beat = m.beat_rate != null ? `${Math.round(m.beat_rate * 100)}% beat` : "beat n/a";
        return `${m.ticker} ${beat} (n=${m.beat_rate_n})`;
      })
      .join(" · ");
    parts.push(`peer beat rates: ${snippets}`);
  }

  if (!parts.length) return null;
  return `Meridian peer cohort — ${parts.join(" · ")}.`;
}
