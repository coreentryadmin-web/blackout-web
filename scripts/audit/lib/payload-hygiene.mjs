/**
 * Pure walkers that flag MALFORMED-BY-CONSTRUCTION leaves in a tool result — the shapes that make
 * a reader guess.
 *
 * WHY. Three separate defects this month were the same bug wearing different clothes: a number
 * arrived without the context needed to read it, and whoever read it filled the gap by guessing.
 * A daily bar carried an epoch and no session date, so a dated close came back off by a full
 * session. Endpoints served `7499.360000000001`, so a price printed with eleven decimals. In both
 * cases the VALUE was right and the PRESENTATION made it unusable.
 *
 * These are the two classes that can be detected mechanically with no judgement and no false
 * positives worth arguing about. Deliberately narrow: a scanner that cries wolf gets muted, and a
 * muted scanner is worse than no scanner. Classes that need judgement (is this level anchored? is
 * this wall on the right side of spot?) are NOT here — they belong to the harnesses that know the
 * domain.
 */

/** Decimal places past which a float is an arithmetic artifact rather than a quoted precision. */
export const MAX_SANE_DECIMALS = 6;

// Epoch-ms roughly 2001-09-09 .. 2033-05-18, epoch-s the same span. Anything outside is a price,
// a volume or an id, not a timestamp — guessing wider produces noise, which is the one thing this
// scanner cannot afford.
const MS_MIN = 1_000_000_000_000;
const MS_MAX = 2_000_000_000_000;
const S_MIN = 1_000_000_000;
const S_MAX = 2_000_000_000;

const ISO_DATE = /\d{4}-\d{2}-\d{2}/;

/** True when a number carries more decimals than any real quote does. */
export function isUnroundedFloat(n) {
  if (typeof n !== "number" || !Number.isFinite(n) || Number.isInteger(n)) return false;
  const s = String(n);
  if (s.includes("e") || s.includes("E")) return false;
  const decimals = s.split(".")[1]?.length ?? 0;
  return decimals > MAX_SANE_DECIMALS;
}

/** "ms" | "s" | null — whether a number sits in a plausible epoch range. */
export function epochUnit(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n >= MS_MIN && n <= MS_MAX) return "ms";
  if (n >= S_MIN && n <= S_MAX) return "s";
  return null;
}

/**
 * True when an object already states a date in words somewhere, so an epoch sitting beside it is
 * not the reader's only way to know when the row is from.
 */
export function carriesReadableDate(obj) {
  if (!obj || typeof obj !== "object") return false;
  return Object.values(obj).some((v) => typeof v === "string" && ISO_DATE.test(v));
}

/**
 * Walk a tool result and return every malformed leaf, as
 * `{ kind, path, value, detail }`. `kind` is "unrounded_float" or "bare_epoch".
 *
 * `maxFindings` bounds the walk. When it trips, the caller is TOLD (`truncated`) rather than
 * handed a short list that looks like a clean bill of health.
 */
export function scanPayload(root, { maxFindings = 200, maxNodes = 200_000 } = {}) {
  const findings = [];
  let nodes = 0;
  let truncated = false;

  const walk = (node, path) => {
    if (truncated || findings.length >= maxFindings) {
      truncated = truncated || findings.length >= maxFindings;
      return;
    }
    if (++nodes > maxNodes) {
      truncated = true;
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (node && typeof node === "object") {
      const labelled = carriesReadableDate(node);
      for (const [k, v] of Object.entries(node)) {
        const childPath = path ? `${path}.${k}` : k;
        if (typeof v === "number") {
          if (isUnroundedFloat(v)) {
            findings.push({
              kind: "unrounded_float",
              path: childPath,
              value: v,
              detail: `${String(v).split(".")[1].length} decimals`,
            });
          }
          const unit = epochUnit(v);
          // Only a field that READS like a time is judged as one — a price of 1.5e12 in market cap
          // is not a timestamp, and flagging it would be exactly the noise that gets a tool muted.
          if (unit && !labelled && /^(t|ts|timestamp|time|start_time|end_time|.*_at|.*_ms|.*_epoch)$/i.test(k)) {
            findings.push({
              kind: "bare_epoch",
              path: childPath,
              value: v,
              detail: `epoch-${unit} with no readable date on the same object`,
            });
          }
        } else {
          walk(v, childPath);
        }
      }
      return;
    }
  };

  walk(root, "");
  return { findings, truncated, nodes };
}

/** Group findings by kind → count, for a one-line rollup. */
export function summarize(findings) {
  const by = {};
  for (const f of findings) by[f.kind] = (by[f.kind] ?? 0) + 1;
  return by;
}
