import "server-only";

import { getBieFullStateForLargo } from "@/lib/bie/full-platform-loader";
import { formatCompactBieFullStateBlock } from "@/lib/bie/platform-read-format";

const DEFAULT_MAX_CHARS = 3200;
const LOAD_TIMEOUT_MS = 4_000;

/** Cross-product platform vitals for Largo's Claude system prompt (Redis bie:full-state or live rebuild). */
export async function loadLargoPlatformSnapshotBlock(opts?: {
  maxChars?: number;
  timeoutMs?: number;
}): Promise<string> {
  const maxChars = opts?.maxChars ?? DEFAULT_MAX_CHARS;
  const timeoutMs = opts?.timeoutMs ?? LOAD_TIMEOUT_MS;

  try {
    const state = await Promise.race([
      getBieFullStateForLargo(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!state) return "";
    return formatCompactBieFullStateBlock(state, maxChars);
  } catch {
    return "";
  }
}
