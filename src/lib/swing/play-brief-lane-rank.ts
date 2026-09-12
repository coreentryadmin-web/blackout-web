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

/** manageAction values whose own trade-manager verdict is "get out" — never a place to "add size".
 *  Excluded from the named leader/comparison pointer below (found live 2026-09-12: CRWD sat #1 by
 *  score at 86.5 while its own manage engine said EXIT_RUNNER, round-tripped from +129.7% peak to
 *  -9.5%; NN's brief still named it "Leader: CRWD @ 86.5 — confirm before adding size", which reads
 *  as "put money here" about a position the desk is actively telling members to exit). */
const EXITING_MANAGE_ACTIONS = new Set(["EXIT", "EXIT_RUNNER"]);

/** Parse strike/right from deck contract label, e.g. "110C · 13DTE". */
export function parseDeckContractLabel(contract: string | null | undefined): {
  strike: number | null;
  right: "C" | "P" | null;
} {
  if (!contract) return { strike: null, right: null };
  const m = contract.trim().match(/^(\d+(?:\.\d+)?)(C|P)\b/i);
  if (!m) return { strike: null, right: null };
  const strike = Number(m[1]);
  const right = m[2]!.toUpperCase() as "C" | "P";
  return Number.isFinite(strike) ? { strike, right } : { strike: null, right: null };
}

function laneRowMatchesPlay(row: HorizonPlay, play: TerminalPlay): boolean {
  if (row.ticker.toUpperCase() !== play.ticker.toUpperCase()) return false;
  const { strike, right } = parseDeckContractLabel(play.contract);
  if (strike == null && right == null) return true;
  if (strike != null && row.contract.strike !== strike) return false;
  if (right != null && row.contract.right !== right) return false;
  return true;
}

function bucketFor(play: TerminalPlay): "open" | "watch" | "closed" {
  if (play.status === "CLOSED") return "closed";
  if (OPEN_STATUSES.has(play.status)) return "open";
  return "watch";
}

function rowInBucket(row: HorizonPlay, bucket: "open" | "watch" | "closed"): boolean {
  if (bucket === "closed") return false;
  // HorizonPlay.status is PlayStatus ("COMMIT" | "WATCH") — DeckStatus OPEN/HOLD/TRIM
  // only exist on the adapted TerminalPlay. Live committed rows are always "COMMIT".
  if (bucket === "open") return row.status === "COMMIT";
  return row.status === "WATCH";
}

/** Pure rank math — testable without DB. */
export function computeLaneRank(play: TerminalPlay, laneRows: HorizonPlay[] | null | undefined): LaneRankSnapshot | null {
  const bucket = bucketFor(play);
  if (bucket === "closed") return null;

  const peers = (laneRows ?? []).filter((r) => rowInBucket(r, bucket));
  if (peers.length < 2) return null;

  const sorted = [...peers].sort((a, b) => b.score - a.score);
  const playScore = play.score ?? 0;
  const contractMatches = sorted.filter((r) => laneRowMatchesPlay(r, play));
  const idx =
    contractMatches.length === 1
      ? sorted.findIndex((r) => r === contractMatches[0])
      : sorted.findIndex((r) => r.ticker.toUpperCase() === play.ticker.toUpperCase());
  const rank = idx >= 0 ? idx + 1 : sorted.length + 1;

  const scores = sorted.map((r) => r.score);
  const medianScore = scores[Math.floor(scores.length / 2)] ?? playScore;
  // Rank/median above stay computed against the FULL peer set — "where does this score fall" is
  // honest regardless of exit state. The NAMED leader is different: it reads as "look at this one",
  // so a peer whose own manage engine already says EXIT/EXIT_RUNNER is skipped in favor of the next
  // best peer still actually held open. Falls back to the raw #1 if every peer is exiting (still
  // shows something rather than nothing) — WATCH-bucket rows never carry manageAction, so this is a
  // no-op there.
  const leaderCandidates = sorted.filter((r) => !EXITING_MANAGE_ACTIONS.has(r.manageAction ?? ""));
  const top = leaderCandidates[0] ?? sorted[0];

  return {
    rank: Math.min(rank, sorted.length),
    total: sorted.length,
    bucket,
    playScore,
    medianScore,
    topTicker: top?.ticker ?? null,
    topScore: top?.score ?? null,
    // Rounded here, not at each narrative call site — a raw float subtraction (e.g. 57.2 - 45.4)
    // produces IEEE754 artifacts like 11.800000000000004 that read straight into the "vs median"
    // narrative line unrounded (live repro: AMZN brief showed "+11.799999999999997 vs median").
    deltaFromMedian: Math.round((playScore - medianScore) * 10) / 10,
  };
}

export function laneRankSection(play: TerminalPlay, laneRows: HorizonPlay[]): RichSection | null {
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
