/**
 * Execution quality from UW ask-side % — aggressive (at ask) vs passive (at bid).
 * Pure helpers; no network.
 */
export type ExecutionQualityBucket = "aggressive" | "passive" | "mid" | "unknown";

export type ExecutionQualitySummary = {
  bucket: ExecutionQualityBucket;
  label: string;
  premium: number;
  count: number;
  pct: number;
  color: string;
};

const BUCKET_META: Record<
  ExecutionQualityBucket,
  { label: string; color: string; hint: string }
> = {
  aggressive: {
    label: "At ask",
    color: "#a3e635",
    hint: "≥60% of volume lifted the offer — aggressive buyer/seller",
  },
  passive: {
    label: "At bid",
    color: "#f87171",
    hint: "≤40% ask-side — passive fill or seller hitting bid",
  },
  mid: {
    label: "Mid",
    color: "#7dd3fc",
    hint: "40–60% ask-side — mixed or midpoint fills",
  },
  unknown: {
    label: "No ask data",
    color: "#64748b",
    hint: "Feed did not report ask-side % for these prints",
  },
};

export function executionQualityBucket(askPct: number | null | undefined): ExecutionQualityBucket {
  if (askPct == null || !Number.isFinite(askPct)) return "unknown";
  if (askPct >= 60) return "aggressive";
  if (askPct <= 40) return "passive";
  return "mid";
}

export function askPctTone(askPct: number | null | undefined): string | null {
  const b = executionQualityBucket(askPct);
  if (b === "unknown") return null;
  return BUCKET_META[b].color;
}

export function executionQualityHint(askPct: number | null | undefined): string {
  return BUCKET_META[executionQualityBucket(askPct)].hint;
}

/** Session rollup for the Execution Analysis panel. */
export function summarizeExecutionQuality(
  flows: ReadonlyArray<{ premium: number; ask_pct?: number | null }>
): ExecutionQualitySummary[] {
  if (!flows.length) return [];
  const map = new Map<ExecutionQualityBucket, { premium: number; count: number }>();
  for (const f of flows) {
    const bucket = executionQualityBucket(f.ask_pct);
    const cur = map.get(bucket) ?? { premium: 0, count: 0 };
    cur.premium += f.premium ?? 0;
    cur.count += 1;
    map.set(bucket, cur);
  }
  const totalPrem = Array.from(map.values()).reduce((s, v) => s + v.premium, 0);
  const order: ExecutionQualityBucket[] = ["aggressive", "passive", "mid", "unknown"];
  return order
    .filter((b) => map.has(b))
    .map((bucket) => {
      const { premium, count } = map.get(bucket)!;
      const meta = BUCKET_META[bucket];
      return {
        bucket,
        label: meta.label,
        premium,
        count,
        pct: totalPrem > 0 ? Math.round((premium / totalPrem) * 100) : 0,
        color: meta.color,
      };
    });
}

/** Fill-quality copy for drilldown — uses fill when present. */
export function executionFillDetail(input: {
  ask_pct?: number | null;
  fill_price?: number | null;
  premium?: number;
}): string | null {
  const aggr = executionQualityBucket(input.ask_pct);
  if (aggr === "unknown") return null;
  const pct = input.ask_pct != null ? Math.round(input.ask_pct) : null;
  const fill =
    input.fill_price != null && Number.isFinite(input.fill_price)
      ? `$${input.fill_price.toFixed(2)}/sh`
      : null;
  if (aggr === "aggressive") {
    return fill
      ? `${pct}% at/above ask · fill ${fill} — lifting the offer`
      : `${pct}% at/above ask — aggressive entry`;
  }
  if (aggr === "passive") {
    return fill
      ? `${100 - (pct ?? 0)}% sold side · fill ${fill} — hitting the bid`
      : `Passive fill (${pct}% ask-side)`;
  }
  return fill ? `Mid fill ${fill} · ${pct}% ask-side` : `Midpoint mix · ${pct}% ask-side`;
}
