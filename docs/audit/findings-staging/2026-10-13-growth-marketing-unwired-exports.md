## 2026-10-13 — [FINDING, P4 dead-code, growth/marketing] Two real, tested-adjacent exports with zero callers — likely designed-ahead, not abandoned — OPEN

> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Growth/marketing infrastructure | P4 — dead code, no runtime impact | OPEN — flagged for the growth/marketing lane owner |

**What's wrong.** A repo-wide dead-export heuristic sweep of previously-unswept `src/lib/`
directories found two real, deliberately-built pieces of growth/marketing infrastructure with
zero callers anywhere in the repo:

1. **`getExperimentVariant`** (`src/lib/experiments/client.ts:52`) — the entire public entry point
   of a complete, cookie-backed A/B-testing client: `getOrCreateAnonId()` (stable 1yr anonymous ID,
   cookie-backed, intentionally not tied to auth "which matters for experiments that touch
   pre-signup surfaces (pricing copy, CTAs)"), deterministic variant assignment via `assignVariant`
   (`./bucket.ts`), and once-per-page-load GA4 exposure tracking. Introduced by `9091e18e9`
   ("feat(experiments): minimal A/B testing layer — deterministic bucketing + GA4 exposure", #1894).
   Its own doc comment gives a concrete usage example naming a specific planned experiment:
   `getExperimentVariant("pricing_guarantee_placement", ["control", "inline"])`. Nothing in the
   repo calls it — no pricing page, no CTA, nothing branches on a variant. `bucket.test.ts` tests
   the underlying `assignVariant` bucketing math, not whether anything uses it.
2. **`appendUtmParams`** (`src/lib/analytics/utm.ts:89`) — a documented "server-safe UTM append"
   function (no `sessionStorage`, so usable outside the browser). Its sibling,
   `appendAttributionToUrl`, is the one actually wired into live marketing links (confirmed via
   grep); `appendUtmParams` itself has zero callers, including from its own sibling.

**Why write up, not delete.** Both pass the two signals this repo's own established precedent
(the X-intel `scoreAttachmentPackage`/`viewsForSurface` entries, 2026-08-10 and since; the Meridian
`suggestedPlayFromThermal` entry, 2026-09-03) uses to distinguish "abandoned" from "built ahead of
the caller that will wire it in": each is a real, non-trivial, deliberately-documented capability
(not a stray leftover), and `getExperimentVariant` in particular names a SPECIFIC planned use
(`pricing_guarantee_placement`) rather than existing as generic unused scaffolding — the clearest
version of "designed ahead" this session has found. Whether the pricing-guarantee experiment ran
and was removed, is still planned, or was abandoned is a call only the growth/marketing lane can
make; same for whether `appendUtmParams`'s server-safe variant is still needed for a surface
`appendAttributionToUrl` doesn't cover (SSR email links, cron-generated content, etc.) or was a
speculative parallel implementation that never found its caller.

**Contrast with what WAS fixed this session.** `LIVE_SIGNAL_LABEL` (Meridian) and `stanceColor`/
`toneColor`/`levelColor` (brand/tokens.ts) were deleted directly rather than deferred, because each
had a specific, checkable, already-identified root cause (a mis-stated "still has consumers" claim
in one case, a feature-removal commit that correctly kept the file but didn't audit every export in
it in the other) — not an open-ended "is this designed ahead" judgment call. These two are the
opposite: real capability, no disqualifying factual error, genuinely ambiguous intent.

**Suggested next step.** For the growth lane: confirm whether `getExperimentVariant` is still
wanted (wire it into the planned pricing-guarantee placement, or remove the whole unused client if
abandoned). For whoever owns `appendUtmParams`: confirm whether `appendAttributionToUrl` already
covers every real use case (delete the server-safe variant if so) or a genuine SSR/cron caller is
still pending.

**Blast radius / what's NOT claimed.** Not a correctness bug — nothing is broken by these being
unwired. No code touched.

Found via a repo-wide dead-export heuristic sweep (every `export function`/`export const` across
previously-unswept `src/lib/` directories — correctness, journal, platform, social, research,
brand, http, native-oauth, explain, confidence, bie, portfolio, meta, experiments, banger, ws,
push, marketing, scan, mobile, faq, analytics, execution — checked for zero cross-file AND zero
same-file references). The sweep's other ~55 candidates in this pass were all same-file false
positives (a constant/helper used by a sibling function in the same file, missed by a naive
cross-file-only grep) except these two and the three brand/tokens.ts functions fixed separately
this session (`2026-10-13-brand-tokens-dead-card-colors.md`). `src/lib/bie/` candidates (21 of the
~61 raw hits) were deliberately excluded from this write-up without individual verification — that
directory's exports are Largo answer-composition machinery (`BIE_LARGO_ANSWER_TTL_MS`,
`composeClarifyRead`, `LARGO_GROUNDING_COVERAGE_THRESHOLD`, etc.), adjacent to the standing Ask
Largo ownership mandate this session does not touch.
