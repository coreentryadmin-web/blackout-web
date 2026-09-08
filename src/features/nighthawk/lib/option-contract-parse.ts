// Pure options-contract string parsing — no I/O, no provider imports. Split out of
// option-chain-prompt.ts (which is otherwise entirely server-only: Polygon/UW fetchers) so a
// client-safe consumer (legacy-play-contract.ts, reachable from the Legacy engine's "use client"
// command-deck components) can depend on this parsing logic WITHOUT the static import graph
// pulling in the provider chain and tripping the client/server boundary checker
// (scripts/audit/client-server-boundary.mjs walks runtime `import` specifiers per file, not
// per-symbol tree-shaking, so importing anything from option-chain-prompt.ts — even a pure
// function — counts as reaching every one of ITS imports, including the unusual-whales.ts ->
// api-tracked-fetch.ts -> api-telemetry.ts -> api-telemetry-persist.ts -> "server-only" chain).
// option-chain-prompt.ts re-exports both names below so every existing server-side caller is
// unaffected.

export type ParsedOptionsContract = {
  strike: number;
  side: "call" | "put" | null;
  expiryYmd: string | null;
};

export function parseOptionsContract(optionsPlay: string): ParsedOptionsContract | null {
  const text = optionsPlay.trim();
  if (!text || text === "—") return null;

  const sideMatch = text.match(/\b(CALL|PUT|C|P)\b/i);
  const sideRaw = sideMatch?.[1]?.toUpperCase() ?? "";
  const side: "call" | "put" | null =
    sideRaw.startsWith("C") ? "call" : sideRaw.startsWith("P") ? "put" : null;

  const strikeMatch =
    text.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:C|P|call|put)\b/i) ??
    text.match(/\b(?:call|put|calls|puts)\s*@?\s*\$?\s*(\d+(?:\.\d+)?)/i) ??
    text.match(/(?:strike|@)\s*\$?\s*(\d+(?:\.\d+)?)/i) ??
    text.match(/\b(\d+(?:\.\d+)?)\s*(?:C|P)\b/i);
  const strike = strikeMatch?.[1] ? Number(strikeMatch[1]) : NaN;
  if (!Number.isFinite(strike) || strike <= 0) return null;

  const isoMatch = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  let expiryYmd = isoMatch?.[1] ?? null;
  if (!expiryYmd) {
    const labelMatch = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*(\d{1,2})\b/i);
    if (labelMatch) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const year = today.getFullYear();
      let parsed = new Date(`${labelMatch[1]} ${labelMatch[2]}, ${year} 12:00:00`);
      if (!Number.isNaN(parsed.getTime())) {
        // Roll to next year only when the date is strictly before today (expired).
        // Do NOT subtract a buffer — that causes January expiries to be rejected
        // as "past" when running on Dec 27-31 and rolled to the wrong year.
        if (parsed < today) {
          parsed = new Date(`${labelMatch[1]} ${labelMatch[2]}, ${year + 1} 12:00:00`);
        }
        expiryYmd = parsed.toISOString().slice(0, 10);
      }
    }
  }

  return { strike, side, expiryYmd };
}
