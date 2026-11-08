import { test, mock } from "node:test";
import assert from "node:assert/strict";

// generateTweetContent's give-up fallback (all 3 dedup-retry attempts exhausted) used to call
// composeHumanTweet() a 4TH time on the stale draftBody instead of reusing the already-composed,
// already-dedup-checked result from the loop's last iteration. composeHumanTweet's enhanceTweetDraft
// step is a real LLM call (temperature 0.75), so that extra call is non-deterministic: it both
// wastes an AI call (the loop's own 3rd composed result is thrown away unused) and ships a tweet
// body that was NEVER checked against isTooSimilarToRecentPosts — defeating the exact duplicate-
// content guard this retry loop exists to enforce, in precisely the case (3 similar attempts in a
// row) it is supposed to protect against hardest.
//
// Relative specifiers throughout (not the "@/..." alias) for both mock.module() and the dynamic
// import() of the module under test — tsx's alias rewrite only applies to statically-parsed
// top-level `import ... from` statements, not these (see flow-gex-enrichment.test.ts's header for
// the same established convention). x-content.ts pulls in `server-only`-guarded provider modules
// transitively (gex-positioning.ts, same reason x-content.test.ts's own header gives for why that
// file can't import x-content.ts directly) — mocking every one of its direct imports here avoids
// ever loading those real modules, which is what makes a real, behavioral import() possible at all.

let composeCalls = 0;
const composeHumanTweetImpl = async (draftBody: string) => {
  composeCalls += 1;
  return {
    body: `BODY_${composeCalls}`,
    draftBody,
    enhanced: true,
    botFlagged: false,
  };
};

mock.module("./providers/anthropic", {
  namedExports: {
    anthropicText: async () => "a fresh ai draft",
  },
});
mock.module("../features/vector/lib/vector-snapshot", {
  namedExports: {
    getVectorGexWallsForHorizon: async () => null,
    getVectorGammaFlipForHorizon: async () => null,
  },
});
mock.module("../features/vector/lib/vector-regime", {
  namedExports: {
    deriveVectorRegime: () => ({ read: "unknown" }),
  },
});
mock.module("./providers/gex-positioning", {
  namedExports: {
    getGexPositioning: async () => null,
  },
});
mock.module("./x-content-humanize", {
  namedExports: {
    composeHumanTweet: composeHumanTweetImpl,
    attachFooter: (body: string, footer: string) => `${body}\n${footer}`,
  },
});
mock.module("./x-whop-link", {
  namedExports: {
    xPostFooterLine: () => "FOOTER",
  },
});
mock.module("./x-content-dedup", {
  namedExports: {
    // Always "too similar" — forces the loop to exhaust all 3 attempts and reach the give-up
    // fallback this test is about.
    isTooSimilarToRecentPosts: async () => ({ similar: true, matched: "prior post" }),
    dedupRewriteHint: () => "",
  },
});
mock.module("./x-marketing-meta", {
  namedExports: {
    getLatestAnalytics: async () => null,
    recordPostHook: async () => {},
  },
});
mock.module("./x-analytics", {
  namedExports: {
    topPerformingHooks: () => [],
  },
});
mock.module("./x-content-schedule", {
  namedExports: {
    selectPostType: () => null,
    isPostWindow: () => false,
    POST_HOURS_ET: [],
    SCHEDULE: [],
  },
});

test("generateTweetContent reuses the last composed draft on give-up, never recomposes unchecked", async () => {
  composeCalls = 0;
  const { generateTweetContent } = await import("./x-content");

  const result = await generateTweetContent("desk_open", {
    spxPrice: 5900,
    regime: "neutral",
  });

  assert.ok(result, "expected a non-null result");
  // Exactly 3 composeHumanTweet calls — one per retry attempt. A 4th call here is the bug: it
  // means the fallback recomposed instead of reusing the loop's last (checked) result.
  assert.equal(
    composeCalls,
    3,
    "composeHumanTweet must be called exactly once per retry attempt (3), never a 4th time on give-up",
  );
  // The returned content must be the loop's OWN 3rd-attempt body — the one that was actually run
  // through isTooSimilarToRecentPosts — not some freshly (and unchecked) recomposed 4th variant.
  assert.equal(
    result!.content,
    "BODY_3\nFOOTER",
    "must post the already dedup-checked 3rd-attempt body, not a never-checked recomposition",
  );
});
