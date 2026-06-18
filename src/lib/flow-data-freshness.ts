let lastFlowDataAt: number | null = null;

/** Mark UW flow data fresh (WS, REST ingest, or desk poll). */
export function markFlowDataFresh(at = Date.now()): void {
  if (!Number.isFinite(at)) return;
  if (lastFlowDataAt == null || at > lastFlowDataAt) {
    lastFlowDataAt = at;
  }
}

export function markFlowDataFromBriefs(flows: Array<{ alerted_at?: string }>): void {
  for (const flow of flows) {
    if (!flow.alerted_at) continue;
    const t = Date.parse(flow.alerted_at);
    if (Number.isFinite(t)) markFlowDataFresh(t);
  }
}

export function flowDataAgeMs(now = Date.now()): number | null {
  return lastFlowDataAt != null ? Math.max(0, now - lastFlowDataAt) : null;
}

export function lastFlowDataTimestamp(): number | null {
  return lastFlowDataAt;
}
