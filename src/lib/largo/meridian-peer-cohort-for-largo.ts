import "server-only";

import { loadMeridianTimelineResponse } from "@/lib/meridian/meridian-snapshot";
import { buildCohortForTimelineItem } from "@/lib/meridian/meridian-peer-cohort-core";
import { loadMeridianPeerReactions } from "@/lib/meridian/meridian-peer-reactions";
import { MERIDIAN_LARGO_WINDOW_DAYS } from "@/lib/largo/meridian-timeline-for-largo";
import { resolveMeridianEventId } from "@/lib/largo/meridian-event-id";
import {
  peerTickersForReactionFetch,
  shapeMeridianPeerCohortForLargo,
} from "@/lib/largo/meridian-peer-cohort-for-largo-core";

type TimelineItem = {
  id: string;
  kind: string;
  ticker: string | null;
  date: string;
  expected_move_pct?: number | null;
  sic_major_group?: string | null;
  sector_label?: string | null;
};

export async function loadMeridianPeerCohortForLargo(input: {
  id?: unknown;
  kind?: unknown;
  ticker?: unknown;
  date?: unknown;
}) {
  const resolved = resolveMeridianEventId({
    id: input.id,
    kind: input.kind,
    ticker: input.ticker,
    date: input.date,
  });

  if (!resolved.id) {
    return {
      available: false,
      error: "bad_event_id",
      note: resolved.reason,
    };
  }

  if (resolved.kind !== "earnings") {
    return {
      available: false,
      error: "not_earnings",
      id: resolved.id,
      note: "Sector peer cohorts apply to earnings prints only — macro, OpEx and FDA events have no SIC peer strip.",
    };
  }

  let payload: Awaited<ReturnType<typeof loadMeridianTimelineResponse>> | null = null;
  try {
    payload = await loadMeridianTimelineResponse(MERIDIAN_LARGO_WINDOW_DAYS);
  } catch {
    return {
      available: false,
      id: resolved.id,
      error: "timeline_lookup_failed",
      note: "The Meridian timeline could not be read. This is NOT evidence that no peers exist.",
    };
  }

  const items = (payload?.items ?? []) as TimelineItem[];
  const subject = items.find((i) => i.id === resolved.id);
  if (!subject?.ticker) {
    return {
      available: false,
      id: resolved.id,
      error: "not_found",
      note:
        "No earnings event matches this id inside the loaded timeline window. Confirm against get_meridian_timeline — ids are only valid for events in the current window.",
    };
  }

  if (!subject.sic_major_group) {
    return {
      available: false,
      id: resolved.id,
      subject_ticker: subject.ticker,
      error: "unclassified_sector",
      note:
        "This name has no SIC major-group classification in the timeline, so a sector cohort cannot be built. This is absence, not a zero peer count.",
    };
  }

  const cohort = buildCohortForTimelineItem(subject, items);
  const peerTickers = cohort ? peerTickersForReactionFetch(cohort, subject.ticker) : [];
  const reactions = peerTickers.length > 0 ? await loadMeridianPeerReactions(peerTickers) : [];

  return {
    available: true,
    id: resolved.id,
    ...shapeMeridianPeerCohortForLargo({
      event_id: resolved.id,
      subject_ticker: subject.ticker,
      cohort,
      reactions,
    }),
    timeline_window_days: MERIDIAN_LARGO_WINDOW_DAYS,
  };
}
