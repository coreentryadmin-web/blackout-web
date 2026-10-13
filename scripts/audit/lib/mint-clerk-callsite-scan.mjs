/**
 * Static scanner: finds every CALL to `mintClerkPremiumSession(...)` in a source file and reports
 * whether its argument list mentions `appUrl`.
 *
 * Why this exists: `mintClerkPremiumSession({ appUrl, ... })` (scripts/audit/lib/prod-clerk-session.mjs)
 * destructures a REQUIRED `appUrl` with no default — calling it with zero arguments throws
 * `TypeError: Cannot destructure property 'appUrl' of 'undefined'` immediately, before any
 * auth/network call happens. Five Largo audit scripts (largo-swing-brief-contract-audit.mjs,
 * largo-comprehensive-validation.mjs, largo-truncation-measurement.mjs,
 * largo-answer-quality-probe.mjs, largo-phase4-answer-quality.mjs) called it bare —
 * `mintClerkPremiumSession()` — and had NEVER successfully authenticated since the day they were
 * added, despite each already defining its own `BASE` constant right there in the file.
 *
 * This is a static lint, not a runtime check, because the whole point is to catch a callsite
 * that would crash the FIRST time it actually runs against a live deployment — exactly the kind
 * of defect that only a prod/live audit run (not `npm test`) would have surfaced otherwise.
 */

/**
 * @param {string} source - file contents
 * @returns {Array<{ line: number, argsText: string, hasAppUrl: boolean }>} one entry per CALL
 *   site (the function's own declaration is excluded).
 */
export function scanMintClerkCallsites(source) {
  const results = [];
  const needle = "mintClerkPremiumSession(";
  let searchFrom = 0;

  while (true) {
    const found = source.indexOf(needle, searchFrom);
    if (found === -1) break;
    const afterOpenParen = found + needle.length;
    searchFrom = afterOpenParen;

    // Skip the function's own declaration ("...function mintClerkPremiumSession(" or
    // "...function* mintClerkPremiumSession(") — not a call site.
    const before = source.slice(Math.max(0, found - 40), found);
    if (/function\s*\*?\s*$/.test(before)) continue;

    const line = source.slice(0, found).split("\n").length;

    // Balance parens forward from the opening "(" already consumed by `needle`, tracking string/
    // template-literal state so a stray ")" or "(" inside a quoted string can't desync the count.
    let depth = 1;
    let i = afterOpenParen;
    let inString = null;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (inString) {
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === inString) inString = null;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch;
      } else if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
      }
      i++;
    }
    const argsText = source.slice(afterOpenParen, Math.max(afterOpenParen, i - 1));
    results.push({ line, argsText, hasAppUrl: /appUrl/.test(argsText) });
    searchFrom = i;
  }

  return results;
}
