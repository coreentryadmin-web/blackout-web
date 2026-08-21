/**
 * Resolve a `--tools=a,b` selection against a harness's curated tool list.
 *
 * WHY THIS IS A MODULE AND NOT THREE LINES INLINE. `largo-payload-hygiene.mjs`
 * documented `--tools=a,b` from the day it was written and never parsed it, so
 * passing it silently scanned the FULL default list and printed a verdict for tools
 * the operator had not asked about. That is the harness's own stated failure mode —
 * "the probe never ran" must not read as "nothing wrong here" — committed by the
 * harness itself: a scan you did not run, laundered as one you did.
 *
 * The rule this encodes: a selection either resolves to exactly what was asked for,
 * or it FAILS LOUDLY. It never silently shrinks, never silently widens.
 *
 * Two failures are kept distinct on purpose:
 *   - `unknown`    — not a real tool at all. A typo. (The first run of that harness
 *                    reported 9/19 coverage because five invented names came back
 *                    EMPTY and read as "this tool has no data".)
 *   - `uncurated`  — a real tool the harness has no argument recipe for. A coverage
 *                    gap, not a typo, and it needs a different fix (add it to the
 *                    list with its inputs), so it must not be reported as one.
 */

/**
 * @param {string[]} only            names from `--tools=`; empty means "no selection"
 * @param {Array<[string, object]>} tools  the harness's curated [name, input] pairs
 * @param {Set<string>} known        every name in the real tool registry
 * @returns {{ selected: Array<[string, object]>, unknown: string[], uncurated: string[], filtered: boolean }}
 */
export function resolveToolSelection(only, tools, known) {
  const requested = (only ?? []).map((t) => String(t).trim()).filter(Boolean);
  if (requested.length === 0) {
    return { selected: tools, unknown: [], uncurated: [], filtered: false };
  }
  const curated = new Set(tools.map(([n]) => n));
  const unknown = requested.filter((n) => !known.has(n));
  const uncurated = requested.filter((n) => known.has(n) && !curated.has(n));
  return {
    // Preserve the CURATED order, not the order the operator typed, so two runs of the
    // same set are diffable line-for-line.
    selected: tools.filter(([n]) => requested.includes(n)),
    unknown,
    uncurated,
    filtered: true,
  };
}
