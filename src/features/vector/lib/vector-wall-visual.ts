import type { LineWidth } from "lightweight-charts";
import type { WallIntegrityTier } from "./vector-wall-integrity";

/** Faint floor so a weak wall is a ghost, not a peer of the session king (Skylit-style
 *  high contrast). Was 0.12 — too bright, which washed every rail to the same weight.
 *  NOTE: this floor governs the ABSOLUTE path (alphaForPct/markerSizeForPct, the legacy
 *  LineSeries fallback + width). The on-chart bead RAIL uses REL_ALPHA_MIN below. */
const ALPHA_MIN = 0.05;
const ALPHA_MAX = 1;
/** Brighter floor for the frame-relative bead rail. Raised from the shared 0.05: on a live
 *  desk the beads were rendering "too light" — a mid-strength wall (half the king) sat at
 *  ~0.29 alpha and early-session modeled beads were near-invisible. A 0.14 floor keeps even
 *  a weak wall legibly present against the #040407 ground while the king still tops out at 1,
 *  so contrast is preserved but the whole rail reads brighter. Separate from ALPHA_MIN so the
 *  absolute/legacy path (and its pinned tests) are untouched. */
const REL_ALPHA_MIN = 0.14;
const WIDTH_MIN: LineWidth = 1;
const WIDTH_MAX: LineWidth = 4;
/** Slightly larger beads — reference product reads chunky on mobile, not pinpoints. */
const RADIUS_MIN = 2;
const RADIUS_MAX = 6;
/** createSeriesMarkers `size` — per-bead, unlike LineSeries pointMarkersRadius (series-wide).
 *  Range widened from [0.5, 3.4] → [0.3, 5.5] so a king wall is unmistakably fatter than a
 *  straggler, and temporal magnitude changes (a wall fading from 30% to 5% over the session)
 *  produce a visibly tapering trail — the "shrinking beads" cue that tells you at a glance
 *  when dealers are unwinding a wall vs building one up. */
const MARKER_SIZE_MIN = 0.3;
const MARKER_SIZE_MAX = 5.5;

/** A wall at/above this share of total |gamma| renders at full visual weight (alpha 1, max size).
 *  Real per-strike GEX share tops out around 6–8% even for the session king (gamma is spread across
 *  ~20 strikes), so the saturation point must sit in that range — a 12% ceiling meant the strongest
 *  wall never reached full boldness. */
const PCT_SATURATION = 7;

function magnitudeT(pct: number): number {
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  // Slightly SUPER-linear (exp > 1) so the strength ratio is PRESERVED, not compressed:
  // the old sqrt (0.55) flattened an 8:1 real-strength ratio to ~3:1, making a dominant
  // wall look barely bolder than a weak one. At 1.15 an 8%-vs-1% wall reads ~9:1 — bold
  // king, faint stragglers, matching how Skylit renders dealer walls.
  return Math.pow(Math.min(1, pct / PCT_SATURATION), 1.15);
}

/** Node opacity scaled by the wall's CURRENT share of total |gamma| — not its rank slot — so a
 *  wall that's actually built up in size reads as visually heavier, and a rank-1 wall barely
 *  ahead of rank-2 looks nearly as faint/strong as its neighbor rather than getting an
 *  artificially large opacity jump just for being first. */
export function alphaForPct(pct: number): number {
  return ALPHA_MIN + magnitudeT(pct) * (ALPHA_MAX - ALPHA_MIN);
}

/** Line thickness scaled the same way as alphaForPct, snapped to lightweight-charts' LineWidth
 *  union (1|2|3|4 — it rejects any other integer). */
export function widthForPct(pct: number): LineWidth {
  const raw = Math.round(WIDTH_MIN + magnitudeT(pct) * (WIDTH_MAX - WIDTH_MIN));
  return Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, raw)) as LineWidth;
}

/** Historical trail dot radius, scaled the same way — legacy LineSeries fallback only. */
export function radiusForPct(pct: number): number {
  return RADIUS_MIN + magnitudeT(pct) * (RADIUS_MAX - RADIUS_MIN);
}

/** Per-bead marker size for createSeriesMarkers — each dot can be its own weight (Skylit-style). */
export function markerSizeForPct(pct: number): number {
  return MARKER_SIZE_MIN + magnitudeT(pct) * (MARKER_SIZE_MAX - MARKER_SIZE_MIN);
}

// ── WALL INTEGRITY RING (second visual channel) ─────────────────────────────────────────────
//
// A bead's SIZE already encodes magnitude (how much dealer gamma is parked there). But size alone
// can't tell a member a wall that has held all session and towers over its neighbors from one that
// just blinked in and sits in a mushy cluster — both can be fat. Integrity (firm/moderate/thin,
// from vector-wall-integrity.ts) is that missing second channel, and the halo already drawn behind
// every core dot is the natural place to render it: modulate the halo into a defined RING.
//
//  - FIRM   → a crisp, bright, slightly larger ring haloing the core: "this wall is real."
//  - MODERATE → a soft halo, close to the legacy glow.
//  - THIN   → halo suppressed to a faint trace, so the bead reads as a bare dot: "about to fold."
//
// The core dot is left entirely to the magnitude channel — the ring never changes a bead's size or
// core opacity, only the glow around it — so the two channels stay independent and legible.
//
// CRITICAL (non-breaking): an UNKNOWN tier (VEX lens, legacy rails with no scoring, any future path
// that doesn't pass integrity) returns the NEUTRAL {1,1} multiplier, so those beads render exactly
// as they did before this channel existed. Rings are strictly additive.

/** Halo alpha ×, halo size × for a wall's integrity tier. Neutral (unknown tier) = {1, 1}. */
export function haloRingForTier(tier?: WallIntegrityTier | null): {
  alphaMul: number;
  sizeMul: number;
} {
  switch (tier) {
    case "firm":
      return { alphaMul: 1.35, sizeMul: 1.18 };
    case "moderate":
      return { alphaMul: 0.85, sizeMul: 1.0 };
    case "thin":
      return { alphaMul: 0.32, sizeMul: 0.9 };
    default:
      return { alphaMul: 1, sizeMul: 1 };
  }
}

// ── RELATIVE (frame-normalized) bead strength ──────────────────────────────────────────────
//
// The absolute magnitudeT above saturates at a FIXED PCT_SATURATION (7%). That's right for the
// UW oracle ladder, where gamma spreads across ~20 strikes so even the session king is only
// ~6-8%. But the per-expiry Polygon-chain path (banded, far fewer strikes) concentrates gamma
// into 20-40% on a SINGLE strike — so on stocks EVERY top wall clears 7% and clips to max size,
// and they all render at identical thickness. That is the "all our beads look the same" report:
// a 41% wall and a 14% wall were drawn the same fat because both saturated.
//
// The fix: for the bead rail, scale each bead against the STRONGEST wall currently in view
// (`maxPct`) instead of a fixed absolute cap. The dominant wall is always the reference (t=1,
// full weight); everything scales down from it — the Skylit fat-king / thin-straggler contrast,
// preserved at any absolute concentration (6% SPX or 40% AMD alike).

/** Contrast exponent for relative strength. >1 widens the gap so a half-strength wall reads
 *  clearly thinner than the king rather than nearly as fat. Tuned to 1.6: 2.0 (squared) was
 *  crushing mid-strength walls into the floor — a wall at half the king's magnitude rendered
 *  at just 25% weight and read as near-dead, part of the "beads too light" report. At 1.6 a
 *  half-king wall reads ~33% (vs 25%) and a 70%-king wall ~57% (vs 49%) — the king↔straggler
 *  contrast is still obvious, but real secondary walls stay legibly present instead of washing
 *  out. Combined with REL_ALPHA_MIN this is the core brightness retune. */
const REL_CONTRAST_EXP = 1.6;

/** Frame-normalized strength in [0,1]: `pct` relative to the strongest wall in view (`maxPct`),
 *  raised to REL_CONTRAST_EXP for separation. 0 for non-positive/non-finite input or maxPct ≤ 0. */
export function relStrengthT(pct: number, maxPct: number): number {
  if (!Number.isFinite(pct) || pct <= 0 || !(maxPct > 0)) return 0;
  return Math.pow(Math.min(1, pct / maxPct), REL_CONTRAST_EXP);
}

/** Per-bead size relative to the frame's strongest wall (the Skylit-contrast bead path). */
export function markerSizeForPctRel(pct: number, maxPct: number): number {
  return MARKER_SIZE_MIN + relStrengthT(pct, maxPct) * (MARKER_SIZE_MAX - MARKER_SIZE_MIN);
}

/** Per-bead core opacity relative to the frame's strongest wall. Uses the brighter REL_ALPHA_MIN
 *  floor so a secondary wall stays legibly present, not a near-invisible ghost. */
export function alphaForPctRel(pct: number, maxPct: number): number {
  return REL_ALPHA_MIN + relStrengthT(pct, maxPct) * (ALPHA_MAX - REL_ALPHA_MIN);
}

/** Per-bead halo opacity relative to the frame's strongest wall (glow grows with strength). */
export function glowAlphaForPctRel(pct: number, maxPct: number): number {
  const t = relStrengthT(pct, maxPct);
  return (REL_ALPHA_MIN + t * (ALPHA_MAX - REL_ALPHA_MIN)) * (0.22 + t * 0.18);
}

// ── ABSOLUTE-MAGNITUDE GLOW CHANNEL (magnitude ≠ frame-relative strength) ────────────────────
//
// Size and core opacity encode FRAME-RELATIVE strength (a wall vs the current king) — deliberately
// normalized so a 6% SPX king and a 40% AMD king both read as "the dominant wall." But that
// normalization discards ABSOLUTE magnitude: a genuinely massive wall (40% of all chain gamma
// parked on one strike) and a modest 6% king look identical. The glow HALO is the free channel to
// restore it — a truly heavy wall gets a wider, brighter halo regardless of its frame rank, so
// "this is a monster wall" reads even when a slightly bigger one shares the frame. Size/opacity
// (relative) stay untouched, so the frame-contrast tests hold; only the halo gains a second voice.

/** Halo brightness/size multiplier from a wall's ABSOLUTE share of chain gamma (independent of the
 *  in-frame king). Neutral 1× at zero magnitude, up to ~1.7× at/above the 7% saturation point. */
export function magnitudeGlowBoost(pct: number): number {
  return 1 + magnitudeT(pct) * 0.7;
}

// ── GROWTH / DECAY VELOCITY CHANNEL (scaling with time — building vs unwinding) ──────────────────
//
// Nothing in the rail encoded a wall's RATE of change: a wall holding steady at 20% and a wall that
// just rocketed from 5% to 20% drew identical beads. But "dealers are STACKING this wall right now"
// vs "this wall is bleeding out" is exactly the 0DTE signal a member wants. This compares a bead's
// share to the PREVIOUS bucket's share (both normalized to the frame king) and modulates the bead:
// a building wall flares brighter + fatter (charging up), a fading wall dims + narrows (dying off),
// steady walls are neutral. This is what makes the rail visibly BREATHE over the session.

const GROWTH_EPS = 0.02; // |Δ share-of-king| below this is "steady" — ignore honest bucket jitter.

/** Per-bead growth/decay modulation from the change in frame-relative share vs the previous bucket.
 *  `prevPct` null/undefined (first bead in a trail) → neutral. Returns clamped alpha/size multipliers
 *  plus building/fading flags for the caller (e.g. a birth/afterglow cue). */
export function growthModulation(
  pct: number,
  prevPct: number | null | undefined,
  maxPct: number
): { alphaMul: number; sizeMul: number; building: boolean; fading: boolean } {
  const neutral = { alphaMul: 1, sizeMul: 1, building: false, fading: false };
  if (prevPct == null || !Number.isFinite(prevPct) || !Number.isFinite(pct) || !(maxPct > 0)) return neutral;
  const dRel = (pct - prevPct) / maxPct; // change in share-of-king since last bucket
  if (dRel > GROWTH_EPS) {
    // Building: scale the flare with how fast it's stacking, capped so a single burst can't blow out.
    const drive = Math.min(1, (dRel - GROWTH_EPS) / 0.25);
    return { alphaMul: 1 + drive * 0.35, sizeMul: 1 + drive * 0.28, building: true, fading: false };
  }
  if (dRel < -GROWTH_EPS) {
    const drive = Math.min(1, (-dRel - GROWTH_EPS) / 0.25);
    return { alphaMul: 1 - drive * 0.32, sizeMul: 1 - drive * 0.22, building: false, fading: true };
  }
  return neutral;
}

// ── ABSOLUTE $-GAMMA BEAD LADDER (continuous perceptual size — magnitude, not frame rank) ────────
//
// Bead SIZE has been FRAME-RELATIVE (relStrengthT normalises every bead to the strongest wall in
// view), so the fattest bead is always "whatever is biggest on screen right now" — a genuinely
// massive wall and a modest one look identical once each is its frame's local king, and a wall's
// bead can even change size just because a bigger wall scrolled into/out of view. Members asked for
// size to read as ABSOLUTE dollar magnitude instead: a size ladder of small / medium / large / huge
// dot ≈ $200M / $600M / $1.2B / $2.5B of dealer-gamma exposure, so a bigger wall stays visibly
// bigger even as the frame's king changes.
//
// beadRadiusForNotional maps a $ exposure onto a pixel radius on a LOG (perceptual) curve. Gamma
// exposure spans orders of magnitude (a live SPX 0DTE king vs a straggler runs a ~680× range), so
// equal RATIOS — 200M→600M→1.2B, each ~2-3× — must feel like equal size STEPS, which a linear map
// cannot do (it would crush the whole low end into the floor). Anchored so ~$200M sits at the floor
// and ~$2.5B at the ceiling; monotonic non-decreasing and saturating in between.
const NOTIONAL_FLOOR_USD = 200e6; // "small" dot — the ladder's bottom anchor
const NOTIONAL_CEIL_USD = 2_500e6; // "huge" dot — the ladder's top anchor

/** Perceptual (log) map from ABSOLUTE $ gamma exposure → bead pixel radius, clamped to
 *  [floorPx, ceilPx]. NaN / 0 / negative → floorPx (never throws, never a giant dot from bad data). */
export function beadRadiusForNotional(
  usd: number,
  { floorPx, ceilPx }: { floorPx: number; ceilPx: number }
): number {
  if (!Number.isFinite(usd) || usd <= 0) return floorPx;
  const lo = Math.log(NOTIONAL_FLOOR_USD);
  const hi = Math.log(NOTIONAL_CEIL_USD);
  const t = (Math.log(usd) - lo) / (hi - lo);
  const clamped = Math.max(0, Math.min(1, t));
  return floorPx + clamped * (ceilPx - floorPx);
}

// PROXY (documented, pending a real notional) ─────────────────────────────────────────────────────
// The bead trail carries a per-strike gamma SHARE (`pct`, % of the ticker's total |gamma|), NOT a $
// figure: GexWallLevel is only { strike, pct }, and the one absolute quantity upstream
// (computeGexWalls' `totalAbsGamma`) is a unitless gamma sum that's discarded before the walls are
// recorded. Threading a REAL gamma-$ total from the ladder through GexWalls → WallHistorySample →
// StrikeTrailPoint AND the DB recorder/persist layer (+ their tests) was out of scope for this
// change. Until StrikeTrailPoint.notional is populated with a real value, we estimate a $ notional as
// share × a nominal book so the ABSOLUTE ladder still applies today: because it is strictly monotonic
// in pct, bead ORDERING/relative magnitude is exact — only the $ CALIBRATION is nominal. To make it
// literal later: thread the real per-ticker |gamma| dollar total onto the trail and set
// StrikeTrailPoint.notional = (pct/100) × thatTotal; the renderer already prefers a real notional.
const NOMINAL_TICKER_GAMMA_USD = 8e9;

/** Estimate a $ gamma notional from a per-strike gamma SHARE (`pct`, 0-100). Proxy — see the note
 *  above. 0 for non-positive/non-finite input (→ the ladder floor). Monotonic in pct. */
export function pctToNotionalProxy(pct: number): number {
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return (pct / 100) * NOMINAL_TICKER_GAMMA_USD;
}

/**
 * Alpha multiplier for MODELED (reconstructed) beads vs OBSERVED (recorded) ones. Modeled beads
 * must read as a FAINT GHOST underlay — clearly secondary to solid recorded beads and to the
 * candles — not a competing wall. The first pass used 0.4, but a 30%-share wall at 0.4 alpha still
 * renders as a bright, solid full-width row (verified live on AMZN/TSLA: the modeled reconstruction
 * back-projects the closing chain across every bucket → full-width rows, and at 0.4 they looked
 * indistinguishable from observed walls — re-creating the "axis-to-axis walls" the modeled underlay
 * was supposed to visually disown). 0.26 keeps the modeled prefix a clear ghost — well under half an
 * observed bead's weight so a real recorded sample always reads as "more real" the moment it
 * overwrites — while lifting it off the 0.15 floor where early-session (mostly-modeled) rails were
 * reported as "too light" / near-invisible before enough observed samples accrued.
 * Honesty is the whole point: modeled ≠ observed must be visible at a glance.
 */
export const MODELED_ALPHA_SCALE = 0.26;
