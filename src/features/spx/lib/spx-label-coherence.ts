// SPX member-facing LABEL COHERENCE — SLAYER-MAP §8 item 7.
//
// THE RULE THIS ENFORCES: any two values a member can see at the same time must either
//   (a) share a label AND agree within a stated tolerance, or
//   (b) carry different labels.
// A shared label over two disagreeing numbers reads as a broken panel. Two different labels over
// one number reads as two findings where there is one.
//
// WHY IT NEEDS TO EXIST AT ALL. The SPX desk legitimately computes FOUR gamma flips and TWO max
// pains (SLAYER-MAP §5) — different expiry scopes, different bases, all correct. Nothing has ever
// checked that the ones sharing a word agree, or that the ones that agree share a word. The
// max-pain pair was disambiguated by hand in 2026-08-23; a checker is what stops the next pair
// from needing to be noticed by eye first.
//
// TWO PROPERTIES THIS DELIBERATELY DOES NOT HAVE:
//   • It never reports OK on absence. A group with fewer than two observed values is INSUFFICIENT,
//     never "coherent" — "I could not compare" must not render as "they agree". That is the single
//     most common way a checker like this becomes worse than none.
//   • It never compares across labels. Different labels are the sanctioned escape hatch (rule b),
//     so comparing them anyway would flag every deliberate distinction as a defect. Instead the
//     INVERSE defect gets its own check: two DIFFERENT labels over the same declared `basis` is a
//     duplicate-naming finding, because a basis is the claim about what a number IS.
//
// Pure — no I/O, no clock, no provider import. The live capture lives in
// scripts/audit/spx-label-coherence.mjs; this file is what it asserts with.

/** One value as a member can see it, on one surface, with the claim it makes about itself. */
export type LabeledValue = {
  /** Where a member reads it: "desk-header", "pin-panel", "ios-desk", "gex-matrix", … */
  surface: string;
  /** The visible label, exactly as rendered. */
  label: string;
  /** The number, or null when that surface had nothing to show. */
  value: number | null;
  /**
   * What the number IS, independent of what it is called — e.g. "gamma-flip:0dte:oi" or
   * "max-pain:near-term:oi". Two values with the same basis are the same quantity and MUST agree;
   * two with different bases may legitimately differ however similar their labels look.
   */
  basis: string;
};

export type CoherenceFinding =
  | {
      kind: "label_collision";
      label: string;
      /** Every distinct basis found under this one label. */
      bases: string[];
      values: LabeledValue[];
      spread: number;
      tolerance: number;
      detail: string;
    }
  | {
      kind: "duplicate_naming";
      basis: string;
      labels: string[];
      values: LabeledValue[];
      detail: string;
    }
  | {
      kind: "insufficient";
      label: string;
      observed: number;
      detail: string;
    };

export type CoherenceReport = {
  /** GREEN only when every group was comparable AND coherent. Absence never produces GREEN. */
  verdict: "GREEN" | "RED" | "INSUFFICIENT";
  findings: CoherenceFinding[];
  /** Groups that were compared and agreed — the positive evidence behind a GREEN. */
  compared: { label: string; surfaces: string[]; spread: number }[];
};

/**
 * Greek SYMBOLS spell out before punctuation is stripped. Without this, `"γ Flip"` normalises to
 * `"flip"` and `"Gamma flip"` to `"gammaflip"` — two labels a member reads as identical would land
 * in different groups and never be compared, which is a silent false negative in the one check
 * whose whole job is catching shared names. The desk renders `γ` today; the rest are here because
 * the same trap applies the moment a Δ or Θ pill ships.
 */
const GREEK_SYMBOLS: ReadonlyArray<[RegExp, string]> = [
  [/[γΓ]/g, "gamma"],
  [/[δΔ]/g, "delta"],
  [/[θΘ]/g, "theta"],
  [/[νΝ]/g, "vega"],
  [/[ρΡ]/g, "rho"],
  [/[σΣ]/g, "sigma"],
];

/** Labels are compared the way a member reads them: case-, punctuation- and symbol-insensitive. */
export function normalizeLabel(label: string): string {
  let out = String(label ?? "").toLowerCase();
  for (const [re, word] of GREEK_SYMBOLS) out = out.replace(re, word);
  return out.replace(/[^a-z0-9]+/g, "");
}

function observed(values: readonly LabeledValue[]): LabeledValue[] {
  return values.filter((v) => v.value != null && Number.isFinite(v.value));
}

function spreadOf(values: readonly LabeledValue[]): number {
  const nums = values.map((v) => v.value as number);
  return Math.max(...nums) - Math.min(...nums);
}

function groupBy<T>(items: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/**
 * Check a set of simultaneously-visible values.
 *
 * `tolerancePts` is an ABSOLUTE index-point tolerance, because that is the unit a member reads a
 * level in — two flips 3 points apart look like the same level; 40 points apart do not. It is a
 * required argument rather than a default: a tolerance nobody chose is a tolerance nobody can
 * defend, and this check's whole value is that the number was stated in advance.
 */
export function checkLabelCoherence(
  values: readonly LabeledValue[],
  tolerancePts: number
): CoherenceReport {
  const findings: CoherenceFinding[] = [];
  const compared: CoherenceReport["compared"] = [];

  // (1) Same label → must agree.
  for (const [, group] of groupBy(values, (v) => normalizeLabel(v.label))) {
    const seen = observed(group);
    const label = group[0]!.label;
    if (seen.length < 2) {
      findings.push({
        kind: "insufficient",
        label,
        observed: seen.length,
        detail:
          seen.length === 0
            ? `"${label}" was not observed on any surface — nothing to compare, and that is not agreement`
            : `"${label}" was observed on only ${seen[0]!.surface} — a single value cannot corroborate itself`,
      });
      continue;
    }
    const spread = spreadOf(seen);
    if (spread > tolerancePts) {
      const bases = [...new Set(seen.map((v) => v.basis))];
      findings.push({
        kind: "label_collision",
        label,
        bases,
        values: seen,
        spread,
        tolerance: tolerancePts,
        detail:
          bases.length > 1
            ? `"${label}" carries ${bases.length} different quantities (${bases.join(", ")}) that differ by ${spread.toFixed(2)}pts — split the label or state the basis on each`
            : `"${label}" is one quantity (${bases[0]}) but the surfaces disagree by ${spread.toFixed(2)}pts (tolerance ${tolerancePts}) — one of them is stale or wrong`,
      });
      continue;
    }
    compared.push({ label, surfaces: seen.map((v) => v.surface), spread });
  }

  // (2) Same basis → must share a label. The inverse defect: one quantity, two names.
  for (const [basis, group] of groupBy(values, (v) => v.basis)) {
    const seen = observed(group);
    if (seen.length < 2) continue; // absence is reported by (1); do not double-count it here
    const labels = [...new Set(seen.map((v) => normalizeLabel(v.label)))];
    if (labels.length > 1) {
      findings.push({
        kind: "duplicate_naming",
        basis,
        labels: [...new Set(seen.map((v) => v.label))],
        values: seen,
        detail: `one quantity (${basis}) is called ${labels.length} different things — a member reading both sees two findings where there is one`,
      });
    }
  }

  const hasReal = findings.some((f) => f.kind !== "insufficient");
  const hasGap = findings.some((f) => f.kind === "insufficient");
  return {
    verdict: hasReal ? "RED" : hasGap ? "INSUFFICIENT" : "GREEN",
    findings,
    compared,
  };
}

/** One-line-per-finding rendering for a CI gate or a run log. Never prints a value's provenance. */
export function formatCoherenceReport(report: CoherenceReport): string {
  const lines = [`LABEL COHERENCE: ${report.verdict}`];
  for (const c of report.compared) {
    lines.push(`  OK           ${c.label} — ${c.surfaces.join(" / ")} agree within ${c.spread.toFixed(2)}pts`);
  }
  for (const f of report.findings) {
    const tag =
      f.kind === "label_collision" ? "COLLISION   " : f.kind === "duplicate_naming" ? "DUP-NAMING  " : "INSUFFICIENT";
    lines.push(`  ${tag} ${f.detail}`);
  }
  return lines.join("\n");
}
