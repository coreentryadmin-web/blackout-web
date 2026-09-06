import type { HorizonPlay } from "@/lib/horizon-plays";

const WORKING = new Set(["OPEN", "HOLD", "TRIM"]);

function fin(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Resolve IV rank for the play brief — fresh dossier read wins over commit-pinned feature_vector. */
export function resolveBriefIvRank(input: {
  dossierIvRank?: number | null;
  featureVector?: Record<string, unknown> | null;
}): number | null {
  const fresh = fin(input.dossierIvRank);
  if (fresh != null) return fresh;
  const pinned = fin(input.featureVector?.iv_rank);
  return pinned;
}

export type ParsedSwingPlayId = {
  ticker: string;
  positionId: number | null;
};

export function parseSwingPlayId(playId: string): ParsedSwingPlayId {
  const parts = playId.split(":").filter(Boolean);
  const ticker = (parts[1] ?? parts[0] ?? "").toUpperCase();
  const pos = parts[2] != null ? Number(parts[2]) : null;
  return { ticker, positionId: pos != null && Number.isFinite(pos) ? pos : null };
}

/** Blank query ticker must not block playId-embedded ticker fallback (Largo play-brief route). */
export function resolveBriefTicker(
  inputTicker: string | undefined | null,
  parsed: ParsedSwingPlayId,
): string {
  const explicit = inputTicker?.trim();
  return (explicit || parsed.ticker || "").toUpperCase();
}

function contractMatches(play: HorizonPlay, strike: number | null, right: "C" | "P" | null): boolean {
  if (strike == null) return true;
  if (play.contract.strike !== strike) return false;
  if (right == null) return true;
  return play.contract.right === right;
}

/** Pick the best lane row when multiple plays share a ticker. */
export function pickLanePlayForBrief(
  rows: HorizonPlay[],
  ticker: string,
  hints: { status?: string | null; strike?: number | null; right?: "C" | "P" | null },
): HorizonPlay | null {
  const upper = ticker.toUpperCase();
  const forTicker = rows.filter((p) => p.ticker.toUpperCase() === upper);
  if (!forTicker.length) return null;
  if (forTicker.length === 1) return forTicker[0]!;

  const right = hints.right ?? null;
  const strike = hints.strike ?? null;

  if (strike != null || right != null) {
    const byContract = forTicker.filter((p) => contractMatches(p, strike, right));
    if (byContract.length === 1) return byContract[0]!;
    if (byContract.length > 1) {
      const live = byContract.find((p) => p.liveStatus);
      return live ?? byContract.sort((a, b) => b.score - a.score)[0]!;
    }
  }

  const status = String(hints.status ?? "").toUpperCase();

  // No status hint: prefer the single live ledger row over a same-ticker WATCH lane row
  // (NRG OPEN 110C vs WATCH 115C — ticker-only playId collision).
  if (!status) {
    const liveOnly = forTicker.filter((p) => p.liveStatus);
    if (liveOnly.length === 1) return liveOnly[0]!;
    if (liveOnly.length > 1) {
      if (strike != null || right != null) {
        const byContract = liveOnly.filter((p) => contractMatches(p, strike, right));
        if (byContract.length === 1) return byContract[0]!;
        if (byContract.length > 1) {
          return byContract.sort((a, b) => (b.livePnlPct ?? 0) - (a.livePnlPct ?? 0))[0]!;
        }
      }
      return liveOnly.sort((a, b) => (b.livePnlPct ?? 0) - (a.livePnlPct ?? 0))[0]!;
    }
  }

  if (WORKING.has(status)) {
    const live = forTicker.filter((p) => p.liveStatus);
    if (live.length === 1) return live[0]!;
    if (live.length > 1 && strike != null) {
      const m = live.find((p) => contractMatches(p, strike, right));
      if (m) return m;
    }
    if (live.length) return live.sort((a, b) => (b.livePnlPct ?? 0) - (a.livePnlPct ?? 0))[0]!;
  }

  if (status === "WATCH" || status === "SKIP") {
    const watch = forTicker.filter((p) => !p.liveStatus);
    if (watch.length === 1) return watch[0]!;
    if (watch.length) return watch.sort((a, b) => b.score - a.score)[0]!;
  }

  const live = forTicker.filter((p) => p.liveStatus);
  if (live.length) return live[0]!;
  return forTicker.sort((a, b) => b.score - a.score)[0]!;
}
