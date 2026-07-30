// src/lib/swing/beta.ts — index beta via OLS over daily returns (PR-6).
//
// The β-weighted-delta risk cap (swing-risk.ts) needs each name's beta to the broad index, but there is NO
// vendor beta field in v1 (SWING-ENGINE.md §6 gap #4). So we DERIVE it the only honest way available: ordinary
// least squares of the name's daily returns against the index's daily returns over the overlapping window —
// beta = cov(name, index) / var(index). That's the same number a data vendor would ship; we just compute it
// from bars the caller already holds instead of paying for a field.
//
// NULL-HONESTY (repo law): a thin/degenerate series is NOT a fabricated beta of 1.0 — it returns
// `betaMissing:true`, `beta:null`, and the propagating risk math marks the position `partial`. `n` reports how
// many paired daily returns actually fed the regression so a caller can see how thin the estimate is.
//
// `fetchNameBeta` accepts an injected `IndexBetaSource` (daily closes for name + index). Without a source it
// returns betaMissing (no silent IO). Production wires `createDailyClosesBetaSource` over the same daily-bar
// fetcher discovery already memoizes — Redis-cache the result (beta moves slowly) so hourly refresh never
// blasts the upstream.
//
// PURE & deterministic — no IO in `computeBeta`.

/** A daily bar — only the close matters for returns; `t` (epoch ms or ymd-sortable) aligns two series when present. */
export interface CloseBar {
  t?: number;
  c: number;
}

/** Minimum PAIRED daily returns for a usable OLS beta. Below this the estimate is too thin → betaMissing. */
export const MIN_BETA_RETURNS = 20;

export interface BetaResult {
  /** OLS slope of name-returns on index-returns, or null when unestimable. */
  beta: number | null;
  /** True when there weren't enough overlapping bars, or the index had zero return variance. */
  betaMissing: boolean;
  /** Number of paired daily returns the regression actually used (0 when missing). */
  n: number;
}

const isFin = (x: number | null | undefined): x is number => x != null && Number.isFinite(x);

/**
 * Align two close series into paired arrays. If EVERY bar on both sides carries a finite `t`, we inner-join on
 * `t` (intersection, ascending) so the pairs are genuinely the same sessions. Otherwise we fall back to a
 * trailing-overlap alignment (last min(len) bars of each) — deterministic, and correct when the caller already
 * passes two same-cadence, same-endpoint series (the common case for a name vs its index).
 */
function alignedCloses(name: CloseBar[], index: CloseBar[]): { name: number[]; index: number[] } {
  const nameHasT = name.length > 0 && name.every((b) => isFin(b.t));
  const indexHasT = index.length > 0 && index.every((b) => isFin(b.t));

  if (nameHasT && indexHasT) {
    const idx = new Map<number, number>();
    for (const b of index) if (isFin(b.c)) idx.set(b.t as number, b.c);
    const pairsN: number[] = [];
    const pairsI: number[] = [];
    for (const b of [...name].sort((a, z) => (a.t as number) - (z.t as number))) {
      if (!isFin(b.c)) continue;
      const ic = idx.get(b.t as number);
      if (isFin(ic)) {
        pairsN.push(b.c);
        pairsI.push(ic);
      }
    }
    return { name: pairsN, index: pairsI };
  }

  const nCloses = name.filter((b) => isFin(b.c)).map((b) => b.c);
  const iCloses = index.filter((b) => isFin(b.c)).map((b) => b.c);
  const k = Math.min(nCloses.length, iCloses.length);
  return { name: nCloses.slice(nCloses.length - k), index: iCloses.slice(iCloses.length - k) };
}

/** Simple daily returns from a close series: r_i = (c_i - c_{i-1}) / c_{i-1}. Null when the prior is non-positive. */
function dailyReturns(closes: number[]): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    out.push(prev > 0 ? (closes[i] - prev) / prev : null);
  }
  return out;
}

/**
 * OLS index beta from two aligned daily-close series. beta = cov(name, index) / var(index) over the paired
 * daily returns. Returns `betaMissing:true` (beta null) when fewer than MIN_BETA_RETURNS pairs survive, or when
 * the index return variance is ~0 (no move to regress against). Never fabricates a beta.
 */
export function computeBeta(nameBars: CloseBar[], indexBars: CloseBar[]): BetaResult {
  const aligned = alignedCloses(nameBars ?? [], indexBars ?? []);
  const nRet = dailyReturns(aligned.name);
  const iRet = dailyReturns(aligned.index);

  // Keep only pairs where BOTH returns are finite.
  const xs: number[] = []; // index returns (regressor)
  const ys: number[] = []; // name returns (response)
  const m = Math.min(nRet.length, iRet.length);
  for (let i = 0; i < m; i++) {
    const y = nRet[i];
    const x = iRet[i];
    if (isFin(y) && isFin(x)) {
      ys.push(y);
      xs.push(x);
    }
  }

  const n = xs.length;
  if (n < MIN_BETA_RETURNS) return { beta: null, betaMissing: true, n };

  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let varX = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    cov += dx * (ys[i] - meanY);
    varX += dx * dx;
  }

  if (!(varX > 0) || !Number.isFinite(varX)) return { beta: null, betaMissing: true, n };
  const beta = cov / varX;
  if (!Number.isFinite(beta)) return { beta: null, betaMissing: true, n };
  return { beta, betaMissing: false, n };
}

// ─── Live fetcher (IndexBetaSource + computeBeta) ─────────────────────────────
/**
 * An index-beta source returns two aligned daily-close series (name + index) so `computeBeta` can regress
 * them. Production wires this over the daily-bar provider discovery already memoizes.
 */
export interface IndexBetaSource {
  alignedDailyBars(ticker: string): Promise<{ nameBars: CloseBar[]; indexBars: CloseBar[] } | null>;
}

/**
 * False once an IndexBetaSource can be wired — the stub path (no source) still returns betaMissing.
 * Kept as a named constant so call sites / tests can branch on "provider available vs not".
 */
export const FETCH_NAME_BETA_DEFERRED = false;

/**
 * Resolve a name's index beta via an injected source. Without a source this does NO IO and reports
 * `betaMissing:true` (never fabricates β=1). With a source: fetch aligned bars → `computeBeta`. Fail-soft
 * on any throw (provider hiccup → partial risk, not a crash).
 */
export async function fetchNameBeta(ticker: string, source?: IndexBetaSource): Promise<BetaResult> {
  if (!source) return { beta: null, betaMissing: true, n: 0 };
  try {
    const bars = await source.alignedDailyBars(ticker);
    if (!bars || !bars.nameBars?.length || !bars.indexBars?.length) {
      return { beta: null, betaMissing: true, n: 0 };
    }
    return computeBeta(bars.nameBars, bars.indexBars);
  } catch {
    return { beta: null, betaMissing: true, n: 0 };
  }
}

/**
 * Build an IndexBetaSource over a daily-closes fetcher (name + SPY by default). The fetcher should already
 * be memoized/cached by the caller (discovery's `closesFor`, or a Redis-backed wrapper) — this helper does
 * not add its own cache so tests stay pure.
 */
export function createDailyClosesBetaSource(opts: {
  fetchCloses: (ticker: string) => Promise<CloseBar[]>;
  indexTicker?: string;
}): IndexBetaSource {
  const index = (opts.indexTicker ?? "SPY").toUpperCase();
  return {
    async alignedDailyBars(ticker: string) {
      const name = ticker.trim().toUpperCase();
      if (!name) return null;
      const [nameBars, indexBars] = await Promise.all([
        opts.fetchCloses(name),
        opts.fetchCloses(index),
      ]);
      if (!Array.isArray(nameBars) || !Array.isArray(indexBars)) return null;
      if (nameBars.length === 0 || indexBars.length === 0) return null;
      return { nameBars, indexBars };
    },
  };
}
