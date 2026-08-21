/**
 * Pure entry-level merge logic for `docs/audit/FINDINGS.md`.
 *
 * Split out of `scripts/audit/findings-merge-resolve.mjs` so the three decisions this file makes --
 * what counts as an entry, what counts as a real edit collision, and what counts as damaged input --
 * can be tested against fixtures instead of only against a live three-stage git merge. Both defects
 * fixed here were found by running the resolver across a 12-PR release batch, and neither could be
 * reproduced without that test surface.
 */

/** A `## ` heading that is NOT at line start -- the damage signature described on `repairGlued`. */
const GLUED_HEADING = /(?<!^)(?<!\n)(## \d{4}-\d{2}-\d{2} — \[)/g;

/**
 * Put a glued heading back at line start.
 *
 * WHY THIS IS NEEDED EVEN THOUGH THE RESOLVER NO LONGER PRODUCES GLUING. The resolver's own output
 * was fixed (see the preamble-separator note in the CLI), but the damage is already ON BRANCHES:
 * any branch that merged before that fix carries entries fused onto the previous line, and those
 * branches are still open. When such a branch becomes a merge stage, `splitEntries` reads the fused
 * heading as body text of the entry above -- so the resolver's own "no silent loss" count check
 * passes (it counts what it wrote, and it wrote what it read) while `findings-hygiene.test.ts` then
 * fails downstream on a file this tool had just declared clean.
 *
 * Measured 2026-08-21 while resolving #2446: four fused headings at lines 5, 16, 32 and 46, none of
 * which the resolver flagged.
 */
export function repairGlued(text) {
  return text.replace(GLUED_HEADING, "\n\n$1");
}

/** Count headings fused onto a preceding line. Zero on a healthy file. */
export function countGlued(text) {
  return (text.match(GLUED_HEADING) || []).length;
}

/**
 * Split into a preamble plus ordered entries.
 *
 * The preamble is everything before the first `## ` heading -- the file's title and its standing
 * instructions, which are shared and must not be duplicated.
 *
 * Heading text alone is NOT a unique key: this file really does carry repeated headings. Keying on
 * text alone made a heading's FIRST occurrence compare against a later one and report both as
 * edited on both sides when neither had changed. Disambiguating by occurrence keeps duplicates
 * distinct without requiring the file be cleaned up first.
 */
export function splitEntries(text) {
  const lines = text.split("\n");
  const firstHeading = lines.findIndex((l) => l.startsWith("## "));
  if (firstHeading < 0) return { preamble: text, entries: [] };

  const preamble = lines.slice(0, firstHeading).join("\n");
  const entries = [];
  const seen = new Map();
  let current = null;
  for (const line of lines.slice(firstHeading)) {
    if (line.startsWith("## ")) {
      if (current) entries.push(current);
      const heading = line.trim();
      const nth = (seen.get(heading) ?? 0) + 1;
      seen.set(heading, nth);
      current = { key: `${heading} #${nth}`, heading, lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) entries.push(current);
  return { preamble, entries };
}

/**
 * Resolve three merge stages into one file body.
 *
 * Returns `{ ok, text, added, contested, repaired }`. `ok === false` with a non-empty `contested`
 * means a genuine edit collision the caller must hand to a human.
 */
export function resolveStages({ base, ours, theirs }) {
  // Repair BEFORE splitting: a fused heading is invisible to the splitter, so damaged input would
  // otherwise be carried through silently and re-emitted as body text of the entry above it.
  const repaired = countGlued(ours ?? "") + countGlued(theirs ?? "") + countGlued(base ?? "");
  const b = base ? splitEntries(repairGlued(base)) : { preamble: "", entries: [] };
  const o = splitEntries(repairGlued(ours));
  const t = splitEntries(repairGlued(theirs));

  const baseKeys = new Set(b.entries.map((e) => e.key));
  const ourKeys = new Set(o.entries.map((e) => e.key));
  const baseText = new Map(b.entries.map((e) => [e.key, e.lines.join("\n")]));

  const added = t.entries.filter((e) => !baseKeys.has(e.key) && !ourKeys.has(e.key));

  // An entry both sides changed is a real edit collision -- UNLESS both sides made the SAME edit.
  //
  // WHY THAT EXCEPTION IS NOT A LOOSENING. Convergent edits are the normal case here, not an edge
  // case: when a lane's finding lands on `main` through a batch PR while the lane branch still
  // carries it, both stages hold byte-identical text. There is nothing to choose between and no
  // information to lose, so refusing is not caution -- it is a false alarm that sends a human off
  // to diff two identical strings. Measured on #2515 and #2502, where the whole "collision" was a
  // single trailing blank line present identically on both sides.
  const contested = t.entries.filter((e) => {
    if (!baseKeys.has(e.key) || !ourKeys.has(e.key)) return false;
    const ourEntry = o.entries.find((x) => x.key === e.key);
    const theirLines = e.lines.join("\n");
    const ourLines = ourEntry ? ourEntry.lines.join("\n") : null;
    if (ourLines === theirLines) return false;
    return theirLines !== baseText.get(e.key) && ourLines !== baseText.get(e.key);
  });

  if (contested.length > 0) return { ok: false, contested, added: [], text: null, repaired };

  const merged = [...added, ...o.entries];
  const body = merged.map((e) => e.lines.join("\n").replace(/\s+$/, "")).join("\n\n");
  const preamble = o.preamble.replace(/\s*$/, "");
  const text = `${preamble}\n\n${body}\n`;

  // NO SILENT LOSS. Re-parse what is about to be written and assert the entry count.
  const headingCount = text.split("\n").filter((l) => l.startsWith("## ")).length;
  if (headingCount !== merged.length) {
    return {
      ok: false,
      contested: [],
      added,
      text: null,
      repaired,
      lost: { expected: merged.length, got: headingCount },
    };
  }
  return { ok: true, contested: [], added, text, repaired };
}
