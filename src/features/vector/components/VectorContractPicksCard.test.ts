import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "src/features/vector");

test("VectorContractPicksCard: loading and quality-bar-empty states are distinct from silent null", () => {
  const src = readFileSync(join(root, "components/VectorContractPicksCard.tsx"), "utf8");
  // Regression guard for the bug where `if (!picks.length) return null;` fired unconditionally —
  // a member had no way to tell "still fetching" apart from "no contract cleared the bar" apart
  // from "no directional play at all" (the one case that legitimately renders nothing).
  assert.match(src, /if \(!picks\.length && !closedPicks\.length\)/, "empty only when no active and no closed picks");
  assert.match(src, /if \(loading\)/, "loading state must be handled before falling through to the quality-bar-empty case");
  assert.match(
    src,
    /pivotPickWaitingCopy/,
    "pivot plays show an honest PLYS waiting state instead of rendering nothing"
  );
  assert.match(src, /vector-contract-picks-list-closed/);
});

test("VectorContractPicksCard: loading state acknowledges a closed session instead of reading as stuck", () => {
  // Regression guard (2026-09-04 audit finding): off-hours, the pick fetch genuinely still runs
  // (verified live — it resolves with real last-session picks, just slower than during RTH), but
  // the loading copy used to be a single hardcoded live-scan sentence with no liveSession branch
  // at all — unlike its sibling VectorHelixRail, which already distinguishes "waiting for prints"
  // from "session closed" once its own loading finishes. A member watching the slower off-hours
  // fetch had no signal the wait was expected, so it read as stuck/broken. Fixed by branching the
  // loading copy on `liveSession` — the fetch itself, and everything once it resolves, is untouched.
  const src = readFileSync(join(root, "components/VectorContractPicksCard.tsx"), "utf8");
  assert.match(src, /liveSession/, "Props must accept liveSession so the loading copy can be session-aware");
  const loadingBlockMatch = src.match(/if \(loading\) \{[\s\S]*?\n {4}\}/);
  assert.ok(loadingBlockMatch, "loading branch must exist");
  const loadingBlock = loadingBlockMatch![0];
  assert.match(
    loadingBlock,
    /liveSession/,
    "the loading branch itself must read liveSession, not just declare the prop"
  );
  assert.match(
    loadingBlock,
    /[Ss]ession closed/,
    "closed-market loading copy must say the session is closed, mirroring VectorHelixRail's pattern"
  );
});

test("VectorContractPicksCard: both call sites thread liveSession through (blast radius)", () => {
  // Same root cause reaches VectorPageShell's action rail (desktop 4th column / mobile Plays
  // segment — the finding's own repro path) AND VectorComparePlayStrip (the 4-up Compare desk's
  // per-ticker play rail) — both call the card with a `loading` prop already, both had liveSession
  // in scope already, and neither passed it through before this fix.
  const shell = readFileSync(join(root, "components/VectorPageShell.tsx"), "utf8");
  const compareStrip = readFileSync(join(root, "components/VectorComparePlayStrip.tsx"), "utf8");
  for (const [label, src] of [
    ["VectorPageShell", shell],
    ["VectorComparePlayStrip", compareStrip],
  ] as const) {
    const callMatch = src.match(/<VectorContractPicksCard[\s\S]*?\/>/);
    assert.ok(callMatch, `${label}: VectorContractPicksCard call site must exist`);
    assert.match(callMatch![0], /liveSession=\{liveSession\}/, `${label}: must pass liveSession into VectorContractPicksCard`);
  }
});
