import { test } from "node:test";
import assert from "node:assert/strict";
import { CURRICULUM } from "./curriculum";
import { getLearnGuide } from "./guides";

/**
 * Guards every guide's own self-declared `chapter` field against CURRICULUM's computed
 * position (LEARN_NAV index + 1). Found live 2026-10-12: `vector.ts` declared `chapter: 8` and
 * `meridian.ts` declared `chapter: 9` — both stale by +1 (no guide declared `7`, and `meridian`
 * collided with `glossary`'s correct `9`) — left over from when Meridian was inserted into the
 * curriculum without reconciling the two tool guides' own hardcoded numbers to the shift.
 *
 * This matters because `LearnGuideView.tsx` renders the page's own header kicker as
 * `guide.kicker ?? \`Chapter ${guide.chapter}\`` (the self-declared field) while
 * `LearnSidebar.tsx` and the prev/next nav render from `CURRICULUM` (the computed, authoritative
 * position) — a mismatch means the SAME page shows two different chapter numbers for itself.
 */
test("every guide's self-declared chapter matches its computed CURRICULUM position", () => {
  for (const entry of CURRICULUM) {
    const guide = getLearnGuide(entry.slug);
    assert.equal(
      guide.chapter,
      entry.chapter,
      `${entry.slug}: guide declares chapter ${guide.chapter}, but its CURRICULUM position is ${entry.chapter}`
    );
  }
});

test("no two guides declare the same chapter number", () => {
  const seen = new Map<number, string>();
  for (const entry of CURRICULUM) {
    const guide = getLearnGuide(entry.slug);
    const prior = seen.get(guide.chapter);
    assert.ok(!prior, `chapter ${guide.chapter} declared by both "${prior}" and "${entry.slug}"`);
    seen.set(guide.chapter, entry.slug);
  }
});
