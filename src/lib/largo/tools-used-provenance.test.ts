import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LARGO_TOOL_DEFS } from "@/lib/largo/tool-defs";
import {
  SPX_ENGINE_TOOL_NAMES,
  HELIX_ENGINE_TOOL_NAMES,
  THERMAL_ENGINE_TOOL_NAMES,
} from "@/lib/largo/tool-defs";

/**
 * `tools_used` HAS THREE KINDS OF ENTRY AND ONE OF THEM IS INDISTINGUISHABLE FROM ANOTHER.
 *
 * The array `largo-terminal.ts` builds — persisted as `bie_interactions.tools_used` — is filled
 * from three different causes:
 *
 *   1. a SEED, `["live_feed_capture"]`, pushed unconditionally before any work happens;
 *   2. PREFETCH markers, pushed when server-side code fetches something on its own initiative;
 *   3. real MODEL DISPATCHES, pushed by `makeGuardedToolRunner` when the model chooses a tool.
 *
 * The file already knows this matters. Two separate comments state the rule outright —
 * `largo-terminal.ts` on the temporal block (*"it must stay a record of TOOLS ACTUALLY CALLED …
 * injecting a token would silently reshape every historical cohort"*) and `tool-guard.ts` on
 * denied tools. Both resisted the temptation correctly.
 *
 * WHAT SLIPPED THROUGH. Kind 2 is normally safe because every prefetch marker is a token that no
 * tool could ever emit — `platform_vitals_prefetch`, `social_content_pack_prefetch`,
 * `meridian_timeline_prefetch`, `desk_prefetch_spx*`. But four prefetch sites push a `get_*` name
 * instead, and one of those four — `get_helix_thermal_compare` — **is a real callable tool**. So
 * that name lands in `tools_used` from two causes nothing downstream can tell apart: a keyword-gated
 * server prefetch (`questionWantsCompareCard()`), and a genuine model dispatch. The other three
 * (`get_peer_ticker_compare`, `get_play_similarity`, `get_pre_earnings_pack`) are unambiguous only
 * by accident — no tool def carries those names today, and nothing stops one being added.
 *
 * WHY THIS IS PINNED RATHER THAN FIXED HERE. Measured, and the honest answer is narrower than the
 * Phase 0 map's: the three BIE calibration cohorts filter by membership of
 * `{SPX,HELIX,THERMAL}_ENGINE_TOOL_NAMES`, and **no non-dispatch marker is in any of those lists**,
 * so no cohort is polluted today. The exposure is latent, not active. But `get_helix_thermal_compare`
 * reads exactly like a Helix engine tool, and the day someone extends `HELIX_ENGINE_TOOL_NAMES` —
 * a one-line change, in another file, by another lane — every server-prefetched compare card joins
 * the Helix cohort as though the model had chosen it. Nothing at that call site would hint at the
 * consequence.
 *
 * Renaming the marker to `helix_thermal_compare_prefetch` (the convention every other prefetch here
 * already follows) is the obvious fix and is NOT taken unilaterally: it changes the shape of a
 * persisted column, which is the coordinator's call, and it is written up as such. What this test
 * does instead is convert a silent trap into a loud one, with the violation visible and shrink-only.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");

/**
 * Files that push NON-DISPATCH markers. A real dispatch is pushed by `tool-guard.ts` as
 * `opts.toolsUsed.push(name)` — a VARIABLE. So a *string-literal* push is, by construction, a
 * non-dispatch marker, and this scan needs no hand-maintained list of them.
 */
const MARKER_SOURCES = ["src/lib/largo-terminal.ts", "src/lib/largo/desk-scope-prefetch.ts"] as const;

function nonDispatchMarkers(): string[] {
  const found = new Set<string>();
  for (const file of MARKER_SOURCES) {
    const src = read(file);
    for (const m of src.matchAll(/toolsUsed\.push\(\s*"([^"]+)"/g)) found.add(m[1]!);
    // The seed is an array literal, not a push: `const toolsUsed: string[] = ["live_feed_capture"]`.
    for (const m of src.matchAll(/const toolsUsed:\s*string\[\]\s*=\s*\[([^\]]*)\]/g)) {
      for (const lit of m[1]!.matchAll(/"([^"]+)"/g)) found.add(lit[1]!);
    }
  }
  return [...found].sort();
}

/**
 * SHRINK-ONLY. Each entry is a non-dispatch marker that collides with a real tool name, i.e. a name
 * whose provenance is already unrecoverable from `tools_used`. Entries may be REMOVED (by renaming
 * the marker) and never ADDED — adding one means a new site just made another name ambiguous.
 */
const KNOWN_AMBIGUOUS: readonly string[] = ["get_helix_thermal_compare"];

test("no non-dispatch marker collides with a real tool name", () => {
  const callable = new Set(LARGO_TOOL_DEFS.map((d) => d.name));
  const markers = nonDispatchMarkers();

  // The scan must actually find markers. A regex that silently stops matching would report a
  // spotless result forever — the vacuous-assertion failure this lane has already shipped twice.
  assert.ok(markers.length >= 20, `only ${markers.length} markers found — the scan is broken`);
  assert.ok(markers.includes("live_feed_capture"), "the unconditional seed was not picked up");

  const colliding = markers.filter((m) => callable.has(m));
  const unexpected = colliding.filter((m) => !KNOWN_AMBIGUOUS.includes(m));

  assert.deepEqual(
    unexpected,
    [],
    `These names are pushed into tools_used by NON-dispatch code AND are real callable tools, so a ` +
      `persisted turn can no longer say whether the model chose them:\n  ${unexpected.join("\n  ")}\n` +
      `\nRename the marker to "<thing>_prefetch" — the convention every other prefetch here follows. ` +
      `Do NOT add it to KNOWN_AMBIGUOUS; that list may only shrink.`,
  );
});

test("KNOWN_AMBIGUOUS shrinks — an entry that got fixed must be removed, not left behind", () => {
  const callable = new Set(LARGO_TOOL_DEFS.map((d) => d.name));
  const markers = new Set(nonDispatchMarkers());

  // The C1-ratchet lesson (FINDINGS 2026-08-21): an allowlist that tolerates stale entries becomes
  // the stale-by-omission failure it was written to prevent. If a marker was renamed, or the tool
  // def removed, the entry has to go.
  const stale = KNOWN_AMBIGUOUS.filter((t) => !(markers.has(t) && callable.has(t)));
  assert.deepEqual(
    stale,
    [],
    `KNOWN_AMBIGUOUS lists names that are no longer ambiguous — delete them:\n  ${stale.join("\n  ")}`,
  );
});

test("no non-dispatch marker sits in a BIE calibration cohort list", () => {
  // This is the consequence that would actually corrupt data: the three cohorts bucket by
  // membership of these lists, so a marker landing in one silently enrols turns the model never
  // steered. Clean today — pinned so it stays that way, and so the danger of the collision above
  // is measured rather than asserted.
  const markers = nonDispatchMarkers();
  const cohorts: Record<string, readonly string[]> = {
    SPX_ENGINE_TOOL_NAMES,
    HELIX_ENGINE_TOOL_NAMES,
    THERMAL_ENGINE_TOOL_NAMES,
  };

  const bad: string[] = [];
  for (const [name, list] of Object.entries(cohorts)) {
    for (const m of markers) if (list.includes(m)) bad.push(`${name} contains the marker "${m}"`);
  }

  assert.deepEqual(
    bad,
    [],
    `A calibration cohort now buckets on a marker that server-side code pushes without the model ` +
      `calling anything:\n  ${bad.join("\n  ")}\n` +
      `\nEvery turn that merely PREFETCHED will be counted as having USED the engine.`,
  );
});
