import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-engine";
import { mergePlayWithCache } from "@/features/spx/hooks/useSpxPlay";

const root = process.cwd();
const source = readFileSync(join(root, "src/features/spx/hooks/useSpxPlay.ts"), "utf8");

function basePlay(overrides: Partial<SpxPlayPayload> = {}): SpxPlayPayload {
  return {
    available: true,
    action: "SCANNING",
    direction: null,
    phase: "FLAT",
    as_of: "2026-07-05T14:00:00.000Z",
    signal_committed: false,
    factors: [],
    gates: { passed: false, blocks: [], warnings: [], play_idea: null },
    levels: {},
    technicals: null,
    mtf: null,
    watch: null,
    telemetry: null,
    confirmations: null,
    ...overrides,
  } as SpxPlayPayload;
}

test("mergePlayWithCache does not resurrect cached confirmations on fresh SCANNING", () => {
  const cached = basePlay({
    action: "WATCHING",
    direction: "long",
    confirmations: {
      passed_count: 4,
      total: 4,
      checks: [{ label: "Tide", detail: "bullish", passed: true }],
    },
  });
  const fresh = basePlay({ action: "SCANNING", direction: "long", confirmations: null });

  const merged = mergePlayWithCache(fresh, cached);
  assert.equal(merged?.action, "SCANNING");
  assert.equal(merged?.confirmations, null);
});

test("mergePlayWithCache still bridges confirmation gaps for same-direction WATCHING", () => {
  const cached = basePlay({
    action: "WATCHING",
    direction: "long",
    confirmations: {
      passed_count: 3,
      total: 4,
      checks: [{ label: "Tide", detail: "bullish", passed: true }],
    },
  });
  const fresh = basePlay({
    action: "WATCHING",
    direction: "long",
    confirmations: null,
  });

  const merged = mergePlayWithCache(fresh, cached);
  assert.equal(merged?.confirmations?.passed_count, 3);
});

test("mergePlayWithCache drops cached confirmations when direction flips", () => {
  const cached = basePlay({
    action: "WATCHING",
    direction: "long",
    confirmations: {
      passed_count: 4,
      total: 4,
      checks: [{ label: "Tide", detail: "bullish", passed: true }],
    },
  });
  const fresh = basePlay({
    action: "WATCHING",
    direction: "short",
    confirmations: null,
  });

  const merged = mergePlayWithCache(fresh, cached);
  assert.equal(merged?.confirmations, null);
});

test(
  "cachedPayload starts undefined — a React #418 hydration-mismatch regression guard",
  () => {
    // Same defect class fixed in useMergedDesk.ts's deskStable ref: a lazy useState
    // initializer that reads sessionStorage during the render React uses for hydration
    // diverges from the server (always undefined, no `window`) whenever a cached play
    // exists client-side, and `play` below folds cachedPayload into the merged result — so
    // that divergence was a guaranteed React error #418 on /dashboard.
    assert.match(
      source,
      /const \[cachedPayload, setCachedPayload\] = useState<SpxPlayPayload \| undefined>\(undefined\);/,
      "cachedPayload's useState initial value must be the literal `undefined`, not a lazy " +
        "initializer reading readSessionCache(...) during the hydration render"
    );
  }
);

test("cachedPayload is hydrated from sessionStorage post-mount, in an effect", () => {
  assert.match(
    source,
    /const cached = readSessionCache<SpxPlayPayload>\(PLAY_CACHE_KEY, PLAY_CACHE_MAX_AGE_MS\);\s*if \(cached\) setCachedPayload\(cached\);/,
    "the session cache must be read inside a useEffect (post-mount), not during render"
  );
});

test("useSWR is not given a fallbackData reading the session cache", () => {
  // fallbackData would reintroduce the same hydration hazard: SWR treats it as the initial
  // `data`, so a client-only cached value would diverge from the server's render the same
  // way cachedPayload's old lazy initializer did. cachedPayload (fixed above) already
  // carries the cached play into `play` via mergePlayWithCache, one tick after mount.
  assert.doesNotMatch(source, /fallbackData:/);
});
