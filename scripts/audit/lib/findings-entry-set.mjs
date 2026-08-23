/**
 * Shared entry-level reasoning about `docs/audit/FINDINGS.md`.
 *
 * ── WHY THIS EXISTS (2026-08-23) ────────────────────────────────────────────────────────────────
 *
 * Two committed tools disagreed about whether a REDUNDANT copy of an entry may be removed, and the
 * disagreement was not academic — it manufactured duplicates on `main`.
 *
 *  - `findings-merge-resolve.mjs` resolves a conflict by taking the UNION of entries. Union
 *    semantics de-duplicate by construction: fold the same entry in from both sides and one copy
 *    comes out. That is correct and is the whole point of the tool.
 *  - `findings-no-loss.test.ts` compared entry headings as a MULTISET, so "3 copies became 1" read
 *    as two deleted findings and turned CI red — on a branch that had done exactly what the
 *    prescribed resolver does.
 *
 * The only way to green was to re-add the redundant copy, which then merged and became permanent.
 * MEASURED on `main`, walking commits that touched the file: the Night Hawk entry
 * ("scanning the whole market") went 0 -> 1 (a lane merge, a9d1c855) -> 2 (that lane's own PR
 * appending it again, e2194732) -> **3**, and the commit that took it to 3 is titled
 * *"fix(findings): restore duplicate Night Hawk entry dropped during earlier rebase"* (7bd99a49).
 * The guard did not merely make duplicates permanent — its prescribed remedy CREATED one.
 *
 * ── THE DISTINCTION THAT RESOLVES IT ────────────────────────────────────────────────────────────
 *
 * The guard's real purpose is that no finding's CONTENT is ever lost. Counting headings
 * over-enforces that in one direction and under-enforces it in another:
 *
 *  - Removing one of N BYTE-IDENTICAL copies loses nothing, by definition. Forbidding it is not
 *    caution, it is a ratchet that only turns one way.
 *  - `main` also carries same-heading entries with DIFFERENT bodies (2026-08-04 Night Hawk scroll,
 *    2026-08-06 discovery-ceiling). Dropping either of those loses a real finding, and a
 *    heading-keyed check cannot tell them apart from redundant copies.
 *
 * So the rule below keys on the heading for PRESENCE (an entry is still superseded by editing its
 * Status, never by deleting it — an edit keeps the heading and the count) while requiring HEAD to
 * retain at least as many copies as the base had DISTINCT VERSIONS. That is strictly stronger than
 * the multiset check on the case that matters, and permissive only where there is provably nothing
 * to lose.
 */

/** Split a FINDINGS-shaped document into whole entries at `^## ` boundaries. */
export function splitEntries(text) {
  const out = [];
  let current = null;
  for (const line of String(text ?? "").split("\n")) {
    if (line.startsWith("## ")) {
      if (current) out.push(current);
      current = { heading: line, lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) out.push(current);
  return out.map((e) => ({ heading: e.heading, body: e.lines.join("\n").trimEnd() }));
}

/**
 * How many copies of each heading HEAD must retain: the number of DISTINCT bodies the base had.
 * Returns a Map<heading, requiredCount>.
 */
export function requiredCounts(baseText) {
  const distinct = new Map();
  for (const { heading, body } of splitEntries(baseText)) {
    if (!distinct.has(heading)) distinct.set(heading, new Set());
    distinct.get(heading).add(body);
  }
  return new Map(Array.from(distinct, ([heading, bodies]) => [heading, bodies.size]));
}

/** Count copies of each heading in a document. Returns a Map<heading, count>. */
export function headingCounts(text) {
  const counts = new Map();
  for (const { heading } of splitEntries(text)) counts.set(heading, (counts.get(heading) ?? 0) + 1);
  return counts;
}

/**
 * Which entries were LOST between base and head. One string per missing copy, so the caller can
 * report "2 findings missing" rather than "2 headings".
 */
export function lostEntries(baseText, headText) {
  const required = requiredCounts(baseText);
  const kept = headingCounts(headText);
  const lost = [];
  for (const [heading, need] of required) {
    const have = kept.get(heading) ?? 0;
    for (let i = have; i < need; i += 1) lost.push(heading);
  }
  return lost;
}

/**
 * Is this staged entry already present, byte-identical, in the target document? Used by the fold
 * script so re-folding cannot append a second copy — the mechanism that started the accumulation
 * above. Compared on the WHOLE entry, so an entry whose body has legitimately changed is still
 * appended rather than silently swallowed.
 */
export function alreadyPresent(targetText, entryText) {
  const wanted = String(entryText ?? "").trimEnd();
  if (!wanted) return false;
  return splitEntries(targetText).some((e) => e.body === wanted);
}
