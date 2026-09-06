/**
 * Lane rank — where this play sits vs peers on the swing serving board.
 */
import type { HorizonPlay } from "@/lib/horizon-plays";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import type { RichSection } from "@/lib/bie/rich-narrative";

export type LaneRankSnapshot = {
  rank: number;
  total: number;
  bucket: "open" | "watch" | "closed";
  playScore: number;
  medianScore: number;
  topTicker: string | null;
  topScore: number | null;
  deltaFromMedian: number;
};

const OPEN_STATUSES = new Set(["OPEN", "HOLD", "TRIM"]);
const WATCH_STATUSES = new Set(["WATCH", "SKIP"]);

function bucketFor(play: TerminalPlay): "open" | "watch" | "closed" {
  if (play.status === "CLOSED") return "closed";
  if (OPEN_STATUSES.has(play.status)) return "open";
  return "watch";
}

function rowInBucket(row: HorizonPlay, bucket: "open" | "watch" | "closed"): boolean {
  if (bucket === "closed") return false;
  if (bucket === "open") return OPEN_STATUSES.has(row.status);
  return WATCH_STATUSES.has(row.status);
}

/** Pure rank math — testable without DB. */
export function computeLaneRank(
  play: TerminalPlay,
  laneRows: HorizonPlay[] | null | undefined,
): LaneRankSnapshot | null {
  const bucket = bucketFor(play);
  if (bucket === "closed") return null;
  if (!laneRows?.length) return null;

  const peers = laneRows.filter((r) => rowInBucket(r, bucket));
  if (peers.length < 2) return null;

  const sorted = [...peers].sort((a, b) => b.score - a.score);
  const playScore = play.score ?? 0;
  const idx = sorted.findIndex((r) => r.ticker.toUpperCase() === play.ticker.toUpperCase());
  const rank = idx >= 0 ? idx + 1 : sorted.length + 1;

  const scores = sorted.map((r) => r.score);
  const medianScore = scores[Math.floor(scores.length / 2)] ?? playScore;
  const top = sorted[0];

  return {
    rank: Math.min(rank, sorted.length),
    total: sorted.length,
    bucket,
    playScore,
    medianScore,
    topTicker: top?.ticker ?? null,
    topScore: top?.score ?? null,
    deltaFromMedian: playScore - medianScore,
  };
}

export function laneRankSection(
  play: TerminalPlay,
  laneRows: HorizonPlay[] | null | undefined,
): RichSection | null {
  const snap = computeLaneRank(play, laneRows);
  if (!snap) return null;

  const label = snap.bucket === "open" ? "OPEN lane" : "WATCH lane";
  const delta =
    snap.deltaFromMedian >= 0
      ? `**+${snap.deltaFromMedian}** vs median`
      : `**${snap.deltaFromMedian}** vs median`;
  const lines = [
    `**#${snap.rank} of ${snap.total}** on ${label} · score **${snap.playScore}** (${delta})`,
    `Lane median: **${snap.medianScore}**`,
  ];
  if (snap.topTicker && snap.topScore != null && snap.rank > 1) {
    lines.push(`Desk leader: **${snap.topTicker}** @ **${snap.topScore}**`);
  }
  if (snap.rank === 1 && snap.total > 1) {
    lines.push("Top-ranked play in this bucket — size and attention follow score.");
  } else if (snap.deltaFromMedian < -15) {
    lines.push("Below median — confirm thesis before adding size; leader may be absorbing flow.");
  }

  return {
    title: "Lane rank",
    body: lines.join("\n\n"),
    bias: snap.deltaFromMedian >= 10 ? "bullish" : snap.deltaFromMedian <= -10 ? "bearish" : "neutral",
  };
}
