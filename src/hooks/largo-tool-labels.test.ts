import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * An unmapped tool name is not invisible — it renders RAW to the member.
 *
 * `TOOL_LABEL` turns internal tool names into source chips. A name with no entry falls through to
 * the identifier itself, and the chip is uppercased by CSS, so `platform_vitals_prefetch` reaches
 * a member as **"PLATFORM VITALS PREFETCH"**.
 *
 * CAUGHT ON PROD 2026-08-20, in a phone screenshot of a real Concrete answer. Auditing the map
 * against every name `largo-terminal.ts` actually pushes found **eight** unmapped, not one:
 *   platform_vitals_prefetch, get_peer_ticker_compare, get_helix_thermal_compare,
 *   get_play_similarity, get_pre_earnings_pack, social_content_pack_prefetch,
 *   ticker_social_guide_prefetch, meridian_timeline_prefetch
 * The screenshot caught one instance of a systematic gap. That is the argument for this test: eyes
 * find instances, a diff finds the class.
 *
 * Same family as #2412 ("The Meridian prefetch already has the week's event board loaded") one
 * layer over — that fixed the model narrating machinery in PROSE; this is the UI printing
 * machinery in CHROME. No prompt change could have fixed it.
 */

const root = process.cwd();
const HOOK = readFileSync(join(root, "src/hooks/useLargoChat.ts"), "utf8");
const TERMINAL = readFileSync(join(root, "src/lib/largo-terminal.ts"), "utf8");

function mappedNames(): Set<string> {
  const start = HOOK.indexOf("const TOOL_LABEL");
  const body = HOOK.slice(start, HOOK.indexOf("};", start));
  return new Set([...body.matchAll(/^\s{2}([a-z0-9_]+):/gm)].map((m) => m[1]));
}

/** Every tool name the SERVER attributes to a turn, from both push sites and the seed array. */
function pushedNames(): Set<string> {
  const out = new Set<string>();
  for (const m of TERMINAL.matchAll(/toolsUsed\.push\("([a-z0-9_]+)"\)/g)) out.add(m[1]);
  for (const m of TERMINAL.matchAll(/toolsUsed:\s*string\[\]\s*=\s*\[([^\]]*)\]/g)) {
    for (const q of m[1].matchAll(/"([a-z0-9_]+)"/g)) out.add(q[1]);
  }
  return out;
}

test("REGRESSION: every server-pushed tool name has a member-facing label", () => {
  const mapped = mappedNames();
  const missing = [...pushedNames()].filter((n) => !mapped.has(n));
  assert.deepEqual(
    missing,
    [],
    `these render raw to members: ${missing.map((n) => `${n} -> "${n.replace(/_/g, " ").toUpperCase()}"`).join(", ")}`
  );
});

test("the sweep actually finds names — the test cannot pass by seeing nothing", () => {
  // A parser that silently matches zero names would make the assertion above vacuous, which is the
  // failure mode of every "no violations found" check. Pin that it sees the real surface.
  const pushed = pushedNames();
  assert.ok(pushed.size >= 8, `expected the real push surface, saw ${pushed.size}`);
  assert.ok(pushed.has("live_feed_capture"), "must see the seeded name");
  assert.ok(pushed.has("platform_vitals_prefetch"), "must see the name from the prod screenshot");
  assert.ok(mappedNames().size >= 40, "must see the real label map");
});

test("no label leaks machinery vocabulary", () => {
  // The point is not merely HAVING a label — it is that the label names WHAT WAS READ, not the
  // mechanism. "prefetch" as a member-facing word is the defect #2412 fixed in prose.
  const start = HOOK.indexOf("const TOOL_LABEL");
  const body = HOOK.slice(start, HOOK.indexOf("};", start));
  for (const [, label] of body.matchAll(/^\s{2}[a-z0-9_]+:\s*"([^"]+)",/gm)) {
    assert.doesNotMatch(
      label,
      /\b(prefetch|cache|payload|endpoint|api|fetch)\b/i,
      `label "${label}" names plumbing, not a read`
    );
  }
});
