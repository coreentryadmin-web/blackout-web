/** Cap tool-result payload size before Postgres persist — heavy cross-desk turns can exceed JSONB limits. */

const DEFAULT_MAX_CHARS = 480_000;

export function largoPersistToolResultsMaxChars(): number {
  const raw = process.env.LARGO_PERSIST_TOOL_RESULTS_MAX_CHARS?.trim();
  const n = raw ? Number(raw) : DEFAULT_MAX_CHARS;
  if (!Number.isFinite(n) || n < 32_000) return DEFAULT_MAX_CHARS;
  return Math.min(Math.round(n), 2_000_000);
}

/**
 * Truncate captured tool results so session persist cannot fail on oversized JSONB.
 * Preserves head results (explicit tool calls) and drops tail live-feed blobs first.
 */
export function truncateCapturedResultsForPersist(results: readonly unknown[]): unknown[] {
  if (!results.length) return [];
  const max = largoPersistToolResultsMaxChars();
  const out: unknown[] = [];
  let used = 2; // []

  for (let i = 0; i < results.length; i++) {
    let chunk: string;
    try {
      chunk = JSON.stringify(results[i]);
    } catch {
      chunk = JSON.stringify({ error: "non_serializable_tool_result" });
    }
    const need = chunk.length + (out.length ? 1 : 0);
    if (used + need > max) {
      out.push({
        _persist_truncated: true,
        kept: out.length,
        dropped_from_index: i,
        dropped_count: results.length - i,
      });
      break;
    }
    out.push(results[i]);
    used += need;
  }

  return out;
}
