import {
  MAX_PEER_REACTION_TICKERS,
  describeCohortPosition,
  type PeerReactionSummary,
  type SectorCohort,
} from "@/lib/meridian/meridian-sector-core";

export type LargoPeerCohortMember = {
  ticker: string;
  report_date: string | null;
  expected_move_pct: number | null;
  avg_reaction_pct: number | null;
  beat_rate: number | null;
  reaction_sample_n: number;
  is_subject: boolean;
};

export function peerTickersForReactionFetch(
  cohort: SectorCohort,
  subjectTicker: string
): string[] {
  const subject = subjectTicker.trim().toUpperCase();
  return cohort.members
    .filter((m) => m.ticker !== subject)
    .slice(0, MAX_PEER_REACTION_TICKERS)
    .map((m) => m.ticker);
}

export function shapeMeridianPeerCohortForLargo(input: {
  event_id: string;
  subject_ticker: string;
  cohort: SectorCohort | null;
  reactions: readonly PeerReactionSummary[];
}): {
  event_id: string;
  subject_ticker: string;
  sector_label: string | null;
  major_group: string | null;
  position_summary: string | null;
  distribution: SectorCohort["distribution"];
  insufficient_reason: string | null;
  members: LargoPeerCohortMember[];
  interpretation: string;
} {
  const subject = input.subject_ticker.trim().toUpperCase();
  const reactionByTicker = new Map(input.reactions.map((r) => [r.ticker.toUpperCase(), r]));
  const cohort = input.cohort;

  const members: LargoPeerCohortMember[] = (cohort?.members ?? []).map((m) => {
    const reaction = reactionByTicker.get(m.ticker);
    return {
      ticker: m.ticker,
      report_date: m.date ?? null,
      expected_move_pct: m.value,
      avg_reaction_pct: reaction?.avgReactionPct ?? null,
      beat_rate: reaction?.beatRate ?? null,
      reaction_sample_n: reaction?.n ?? 0,
      is_subject: m.ticker === subject,
    };
  });

  const positionSummary = describeCohortPosition(cohort, { unit: "%", noun: "Implied move" });

  return {
    event_id: input.event_id,
    subject_ticker: subject,
    sector_label: cohort?.label ?? null,
    major_group: cohort?.majorGroup ?? null,
    position_summary: positionSummary,
    distribution: cohort?.distribution ?? null,
    insufficient_reason: cohort?.insufficientReason ?? null,
    members,
    interpretation:
      "Sector peers are same-SIC-major-group earnings names in the loaded Meridian timeline window. " +
      "expected_move_pct ranks forward implied moves; avg_reaction_pct and beat_rate come from each peer's " +
      "own settled print history (same engine as the desk History tab). Omitted fields mean unknown, not zero.",
  };
}
