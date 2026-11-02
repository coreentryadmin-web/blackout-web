/**
 * Pure formatter for cron-dst-audit.mjs's final "COVERAGE" + registry-mismatch sections.
 *
 * Extracted into its own module (with its own regression test) because the two sections used
 * to be printed inside a SINGLE `if (mismatches.length)` guard in cron-dst-audit.mjs. That is a
 * real bug: the COVERAGE section — which lists DEPLOYED jobs this audit never classified, and
 * whose own header comment in cron-dst-audit.mjs says it is "Loud and visible, not blocking" —
 * silently stopped printing in text mode whenever the UNRELATED registry-vs-manifest mismatch
 * list happened to be empty, which is the common/healthy case (registry mirror usually agrees
 * with the deployed manifest). So on an ordinary clean run with, say, 26 of 39 deployed jobs
 * actually covered by GATES/INTENTS, the text-mode report said nothing about the other 13 at
 * all — exactly the "absence reads as health" failure shape this audit exists to catch, now
 * sitting inside the instrument itself. `--json` mode was unaffected (it always includes
 * `coverage` in its output), which is how this went unnoticed for a while.
 *
 * Each section below now gates on its OWN condition instead of borrowing the other's.
 */

export function pad(s, n) {
  return String(s ?? "—").padEnd(n);
}

/**
 * @param {{
 *   manifestSize: number,
 *   unaudited: string[],
 *   mismatches: { key: string, registry: string, deployed: string, kind: string }[],
 * }} input
 * @returns {string[]} Lines to print, in order. Empty when there is nothing to report (every
 *   deployed job is covered by GATES/INTENTS AND there are no registry/manifest mismatches).
 */
export function buildCoverageReport({ manifestSize, unaudited, mismatches }) {
  const lines = [];
  const covered = manifestSize - unaudited.length;

  // COVERAGE: always shown whenever there is a deployed manifest to report coverage over —
  // independent of whether the registry-mismatch list below happens to be empty.
  if (manifestSize > 0) {
    lines.push(`\nCOVERAGE — ${covered} of ${manifestSize} deployed jobs are in GATES or INTENTS`);
    if (unaudited.length) {
      lines.push(
        `  ${unaudited.length} deployed job(s) are in NEITHER table. They are UNAUDITED, not OK — this ` +
          `run says nothing about them:`
      );
      for (const k of unaudited) lines.push(`    ${k}`);
      lines.push(
        "  Add each to GATES (it applies an ET gate) or INTENTS (it has an ET-relative intent, or is " +
          "UTC-labelled and should say so), after reading its route. Absence from both tables is a gap " +
          "in this audit, never a verdict about the job."
      );
    }
  }

  // Registry-vs-deployed mismatch list: gated on its OWN condition, not COVERAGE's.
  if (mismatches.length) {
    lines.push("\nREGISTRY `schedule_cron_utc` vs DEPLOYED MANIFEST");
    for (const m of mismatches) {
      lines.push(`  ${pad(m.key, 27)} registry=${pad(m.registry, 26)} deployed=${pad(m.deployed, 26)} — ${m.kind}`);
    }
  }

  return lines;
}
