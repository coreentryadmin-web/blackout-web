// src/lib/swing/beta.ts — index beta via OLS over daily returns (PR-6).
//
// The β-weighted-delta risk cap (swing-risk.ts) needs each name's beta to the broad index, but there is NO
// live beta fetcher in v1 (SWING-ENGINE.md §6 gap #4). So we DERIVE it the only honest way available: ordinary
// least squares of the name's daily returns against the index's daily returns over the overlapping window —
// beta = cov(name, index) / var(index). That's the same number a data vendor would ship; we just compute it
// from bars the caller already holds instead of paying for a field.
//
// NULL-HONESTY (repo law): a thin/degenerate series is NOT a fabricated beta of 1.0 — it returns
// `betaMissing:true`, `beta:null`, and the propagating risk math marks the position `partial`. `n` reports how
// many paired daily returns actually fed the regression so a caller can see how thin the estimate is.
//
// `fetchNameBeta` is DEFERRED: no provider is wired in v1 (per the §6 gap). It exists as a documented
// interface/stub so a future provider slots in without changing call sites — it does NO IO today.
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

// ─── DEFERRED live fetcher (v1 gap #4) ─────────────────────────────────────────
/**
 * A future index-beta source. When a provider exists it returns two aligned daily-close series (name + index)
 * so `computeBeta` can regress them. DEFERRED — no implementation is wired in v1; the interface is here so a
 * provider drops in without touching callers.
 */
export interface IndexBetaSource {
  alignedDailyBars(ticker: string): Promise<{ nameBars: CloseBar[]; indexBars: CloseBar[] } | null>;
}

/** True while no live beta provider is wired — callers derive beta via `computeBeta` over bars they already hold. */
export const FETCH_NAME_BETA_DEFERRED = true;

/**
 * DEFERRED stub. There is no live index-beta provider in v1, so this does NO IO and always reports
 * `betaMissing:true`. A caller wanting a real beta computes it with `computeBeta` over bars it already fetched.
 * When a provider is provisioned, implement it via `IndexBetaSource` + `computeBeta` here — no call site changes.
 */
export async function fetchNameBeta(_ticker: string, _source?: IndexBetaSource): Promise<BetaResult> {
  return { beta: null, betaMissing: true, n: 0 };
}
