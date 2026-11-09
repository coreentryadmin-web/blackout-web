/**
 * Pure formatting helpers for ZeroDteBoard.tsx, split out so they can be covered by a plain
 * `node:test` run — a `.tsx` client component has no render harness in this repo (see
 * zerodte-board-strips.tsx/.test.ts for the same split precedent on this exact file).
 */

/**
 * Compact dollar magnitude for the 0DTE Command board's flow strips, e.g. "$1.2M gross" /
 * "$840K last 30m" (rendered at ZeroDteBoard.tsx's `s.gross_premium`/`s.recent_premium_30m`
 * call sites).
 *
 * ROOT CAUSE this fixes (K→M unit-boundary rounding — the same bug class already fixed across
 * 16+ sibling formatters repo-wide, e.g. `fmt-money.ts`'s `fmtPremium`, `thermal-compact-matrix.ts`,
 * `helix-tide-money-format.ts`, `darkpool-discord-format.ts`'s `fmtShares`): the K branch divided
 * by 1,000 and rounded with `toFixed(0)` with NO check for whether the rounded quotient reached
 * 1000 of that unit — so a value just under the $1,000,000 cutoff (e.g. 999,600, a realistic 0DTE
 * aggregate `gross_premium`/`recent_premium_30m` figure for a session's flow) fell into the K
 * branch (`abs >= 1_000_000` is false) and rendered as the four-digit, wrong-unit `"$1000K"`
 * instead of promoting to `"$1.0M"` — the exact overflow `fmt-money.ts`'s own `fmtPremium` doc
 * comment calls out ("999_700 must read $1.0M, never $1000K"). This file's `fmtMoney` never got
 * that guard (it was written as its own standalone copy rather than reusing the already-fixed
 * shared helper — see `git log -L` on this function, untouched since the file's original
 * migration commit), so it silently carried the bug class every sibling formatter was already
 * fixed for.
 *
 * Fix: round FIRST, then re-check (by magnitude, since `n` may be negative) whether the rounded
 * value actually belongs in the next unit up — same shape as `fmt-money.ts#fmtPremium`'s own
 * K→M guard. Deliberately keeps every other branch (including the pre-existing sign-inside-the-
 * glyph placement for a negative `n`, e.g. "$-1.2M") byte-identical to the original so this fixes
 * only the one unit-boundary defect, not a second, unrelated formatting convention.
 *
 * SECOND INSTANCE OF THE SAME CLASS (round 504): this function also had NO B tier at all, so
 * `abs >= 1_000_000` unconditionally returned the M-unit string with no overflow check one unit
 * higher — the exact "no B tier" shape `meridian-earnings-intel-core.ts` (round 419) was already
 * fixed for. A genuine >=$1B value (e.g. a whole-market 0DTE flow aggregate on an extreme session)
 * rendered as the four-digit, wrong-unit `"$1250.0M"` instead of promoting to `"$1.3B"`, and a
 * value that only ROUNDS up into the billions at M's own 1dp precision (999_950_000) hit the
 * identical round-first-then-promote overflow this file's own K→M fix above already describes —
 * just one unit higher ("$1000.0M" instead of "$1.0B"). Fixed with the same round-first-then-
 * promote guard shape as the K→M branch, mirroring `fmt-money.ts#fmtPremium`'s B-before-M
 * ordering and keeping the M/K branches' existing conventions (sign inside the glyph, 1dp for M,
 * whole-number K) untouched.
 */
export function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) {
    const m = Math.round((abs / 1_000_000) * 10) / 10;
    // A value that rounds to 1000 of this unit belongs in the next unit up, not an overflowed
    // four-digit label (e.g. 999_950_000 must read "$1.0B", never "$1000.0M"). Compared by
    // magnitude (abs), same as the K→M guard below, since `n` may be negative.
    if (m >= 1000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
    return `$${(n / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    const k = Math.round(n / 1_000);
    // A value that rounds to 1000 of this unit belongs in the next unit up, not an overflowed
    // four-digit label (e.g. 999_600 must read "$1.0M", never "$1000K"). Compared by magnitude
    // since `k` can be negative.
    if (Math.abs(k) >= 1000) return `$${(n / 1_000_000).toFixed(1)}M`;
    return `$${k}K`;
  }
  return `$${n.toFixed(0)}`;
}
