# UI-UX-OPPORTUNITIES — the backlog

**Lane:** UI/UX & Product Experience (owner), per `docs/agents/briefs/ui-ux.md` item 16: "maintain
a backlog for larger ideas that aren't yet a PR — so a discovery doesn't disappear just because it
wasn't immediately implemented." Living document, updated as ideas surface and as they're either
shipped (move to a PR / `FINDINGS.md`, cross out here) or deliberately declined (say why, keep the
line so it isn't rediscovered from scratch).

This is distinct from `docs/audit/UI-UX-MAP.md` (the inventory of what exists) and
`docs/audit/findings-staging/` (confirmed defects with a code fix in flight). This file is for
ideas that are real but not yet scoped into either — a redesign direction, a missing interaction,
a pattern worth generalizing. Classify with the brief's own scale:

- **P0** — broken/confusing (usually belongs in `UI-UX-MAP.md`'s findings table or
  `findings-staging/` instead, once confirmed — see that file's §10 for the current candidates)
- **P1** — major UX problem
- **P2** — high-value enhancement
- **P3** — experimental interaction

---

## Open ideas

1. **[P2] Cross-product ticker/context carryover in the nav switcher.** `UI-UX-MAP.md` §1.1: the
   "Features" dropdown that switches between all 7 products is a set of bare static links — moving
   from Helix (viewing NVDA) to Thermal does not deep-link NVDA. A member investigating one name
   across products has to re-search on every switch. Needs a design for what "context" even means
   across products with different primary entities (a ticker on Helix/Thermal/Vector/Meridian vs.
   an engine tab on Night Hawk) before this is buildable — not a small fix, a real design question.

2. **[P2] A shared freshness/status badge component.** `UI-UX-MAP.md` §10 catalogs 4+ different
   visual forms for "how old is this data" across Helix, Thermal, Vector, Meridian, and Largo.
   Largo's per-subsystem "● HELIX ● THERMAL ● VECTOR ● NIGHT HAWK ● SLAYER ● 0DTE  5/6 ONLINE" row
   is the best existing example — worth studying as the starting point rather than designing from
   scratch. Needs a live-market pass first to see every product's "fresh" state, not just this
   pass's closed-market ones.

3. **[P2] iOS's Flow↔Thermal segment control has no equivalent for the other 5 products or on
   web.** `IosIntelligenceHubSegment` proves the pattern works (client-side product switch, no full
   navigation) but only covers 2 of 7 products and only inside the native shell. Worth asking
   whether it generalizes to Vector/Meridian/Night Hawk/SPX Slayer/Largo, and whether a desktop-web
   equivalent (not just iOS) is warranted given brief item 10's cross-product investigation
   standard.

4. **[ANSWERED, 2026-08-24 — already resolved by the same-day P0 retraction, no separate decision
   needed] SPX Slayer's Vector/Matrix/Intel single-panel tabs vs. a true multi-panel desktop
   layout.** This item asked, pending the §2 P0 (blank left column) being root-caused, whether
   desktop SPX Slayer *should* show all panels at once rather than single-panel tabs. That P0 was
   root-caused the same day it was filed (`UI-UX-MAP.md` §2's correction note) as a wrong-UA
   methodology bug, not a product defect — and the correction already answers this item's design
   question in the process: **the real desktop layout already IS the 4-column multi-panel
   composition** (Pulse/Largo rail, Dealer Gamma Map, EOD Pin Forecaster, Vector chart, all mounted
   simultaneously, no tabs) — confirmed independently by the SPX lane's own same-day
   `docs/spx/SPX-SLAYER-CERTIFICATION.md`, which reports zero blank-panel findings on this exact
   layout. The single-panel `iosPanel` tabs are real but correctly scoped to the compact/native
   shell only, never shown at desktop 1440×900 with the correct UA — so there's no separate "should
   desktop show all panels" decision left to make; it already does. Closing this item rather than
   leaving a design question open that the evidence already settled.

5. **[P3] Night Hawk's empty state on a no-session day leaves ~45% of the mobile viewport
   blank.** (`UI-UX-MAP.md` §7.) Candidate content for that space: recent closed plays, a teaser
   for the other 3 engine tabs (Swings/Bangers/Legacy), or a countdown to the next session. Not
   urgent — it's not broken, just under-used space on a day with genuinely nothing to show.

6. **[ANSWERED, 2026-08-25 — closed by code-identity, live re-check attempted but blocked by an
   environment issue this pass] `/dashboard` desktop inherits the footer-legend fix automatically —
   it is not a separate code path to verify.** Traced `SpxVectorEmbed.tsx` (the `/dashboard`
   embed): it dynamically imports and renders `VectorPageShell`, the exact same component tree
   `/vector` itself renders, with no props or wrapper that touch, override, or conditionally skip
   the footer-label JSX. The fixed pill markup (`bg-black/70`, width cap, truncate — the same lines
   read for `UI-UX-MAP.md` finding #3) lives directly in `VectorChart.tsx` at the leaf the embed
   also renders, so there is no scenario where `/dashboard` executes different code for this label
   than `/vector` does — this is one function running in two places, not two implementations that
   happen to look alike. A live chart-loaded screenshot of `/dashboard` desktop was attempted to
   confirm visually as well, but `proxy-browser.cjs` hit `ERR_CONNECTION_RESET` on **every** target
   including the homepage across 4 consecutive attempts (with `recentRelayFailures: []` on the
   proxy status, curl to the same URLs succeeding throughout) — consistent with the tunnel-
   exhaustion failure mode `proxy-tunnel-context.cjs`'s own header comment documents (leaked
   CONNECT tunnels from a prior long run present as this exact signature: Chromium reports
   `ERR_CONNECTION_RESET`, the proxy has nothing to report because it is saturated, not failing).
   Not chased further since the code-identity evidence is airtight regardless of what a screenshot
   would add — a live re-check remains a reasonable follow-up whenever the tunnel clears, not a
   blocker on closing this. The second half of the original ask (auditing whether *other*, future
   embeds of `VectorChart.tsx` could diverge) stays real but speculative — no second embed exists
   yet to check.

7. **[DONE, 2026-08-23] `proxy-browser.cjs` now warns loud when `--viewport` implies desktop but
   `--desktop` is omitted.** This Phase 0 pass shipped 8 desktop findings built on the wrong UA
   (`docs/audit/UI-UX-MAP.md`'s top-of-file correction) because the script's own doc comment warned
   about this exact trap but nothing enforced it — a viewport of `1440x900` silently rendering with
   `isMobile:true` and the `BlackOutiOSApp` UA is a footgun the tool handed every user of it, on
   every lane, not just this one. Fixed in the same PR as this file's correction pass: `mobileUaWarning()`
   in `proxy-browser.cjs` prints a loud stderr warning (not a hard refusal — an intentional
   mobile-UA-at-wide-viewport shot is rare but legitimate) when width ≥ 1024px is passed without
   `--desktop`. Unit-tested in `proxy-browser.test.mjs`. Kept here rather than deleted so the next
   reader can see WHY the warning exists, not just that it does.

8. **[DONE, 2026-08-23] `parseTier("admin")` fallthrough to "Free" — resolved WITHOUT needing a
   live browser.** This item originally said the question needed a real hydrated admin session to
   settle, since this lane's minted sessions can't distinguish "the hook never hydrated" from "the
   hook hydrated and genuinely resolved to Free." That framing was too cautious: the actual
   question — does `parseTier("admin")` return `"free"`, and does any real component feed it that
   value — is a pure static-tracing question, answerable from the source without a browser at all.
   Traced it: `ClerkAuthBridge` does set `useAppAuth().tier = "admin"` for `role:admin` users
   (`src/lib/auth-client.tsx`), and `AccountMembershipPanel` (`/account`) and `PlanLadder`
   (`/pricing`, `/upgrade`) both fed that value straight into `parseTier`, which has never
   recognized the string `"admin"`. That's independent of hydration timing — confirmed and fixed
   the same day. See `docs/audit/findings-staging/2026-08-23-admin-tier-display-fallthrough.md`.

9. **[P2, needs infra-level (ECS task) visibility this sandbox doesn't have — leading hypothesis
   identified, NOT confirmed] Vector's gamma-regime banner absent across TWO independent live
   interaction walkthroughs — off-hours AND live RTH.** `UI-UX-MAP.md` §5: the committed
   `vector-ui-walkthrough.cjs` harness (desktop, SPY, 16 interaction states) found
   `[data-testid=vector-regime-banner]` missing in all 12 non-exempt states on **both** an
   off-hours run (2026-08-23, weekend) and a live-RTH re-run (2026-08-24, Mon, market open) —
   the second run's play card generated genuinely fresh, live-computed reads ("SCALP · momentum
   short on continuation → target magnet/VWAP 763.67"), ruling out "no data exists right now" as
   the explanation. `VectorRegimeBanner` self-hides on `posture:"unknown"` (documented,
   intentional) so absence alone isn't proof of a bug — but a direct, isolated fetch of the two
   endpoints its SSR seed path depends on (`/api/market/vector/walls`,
   `/api/market/vector/expected-move`) returned real, fresh positioning data 3/3 attempts outside
   the harness both times.
   **Code trace, 2026-08-24 — narrowed the mechanism without fully confirming it.** Regime is
   computed by `emitRegime()` in `VectorChart.tsx` (~line 3048) from `liveGexWalls()`/
   `liveGammaFlip()`, and — contrary to the original hypothesis — this fires **unconditionally on
   interaction**, not just via the SSE stream: the `lens`-change effect (~line 3611) resets the
   dedup key and calls `emitRegime()` directly, and the walkthrough's own GEX↔VEX lens clicks
   (states 07/08) should have triggered it. Both `liveGexWalls`/`liveGammaFlip` and the SSR seed
   (`loadVectorSeedProps` → `getVectorGammaFlip`/`getVectorGexWalls`, `vector-snapshot.ts`) read
   from the **same per-request-process, in-memory server cache** (`state(ticker)`), populated by
   that specific server process's own live UW WebSocket connection or a fallback poll — there is
   no cross-instance sync (unlike the Redis-backed caches used elsewhere in this codebase for
   exactly this reason). **Leading hypothesis:** on ECS, multiple task instances each run this
   in-memory cache independently; a request that happens to land (via the ALB) on a task whose UW
   WS connection is cold/reconnecting, or whose fallback poll hasn't warmed yet, would see
   `posture:"unknown"` regardless of interaction, while a *different* request (a fresh direct REST
   call, or a differently-routed page load) lands on a warm task and gets real data — fully
   consistent with everything measured. **Why this stays unconfirmed, not filed as a finding:**
   confirming it requires seeing per-task cache/WS-connection state (ECS `exec` or task-level
   logging), which this sandbox has no access to (`CLAUDE.md`'s standing note: AWS creds are
   session-dependent and even when present there's no ECS exec path documented here). A fix would
   mean either backing this cache with something cross-instance-consistent (a real architecture
   change) or having the client self-heal a cold SSR seed with its own direct fetch instead of
   relying solely on the SSE stream — both are decisions for Vector's owning lane, not something to
   guess at unilaterally (per this file's own boundary rule). Repro: `env -u AWS_ACCESS_KEY_ID -u
   AWS_SECRET_ACCESS_KEY NODE_USE_ENV_PROXY=1 node scripts/audit/vector-ui-walkthrough.cjs
   --ticker=SPY` (run during RTH to rule out off-hours as a confound — already done once with the
   same result). Next step for whoever picks this up: either get ECS task-level visibility to
   confirm the multi-instance-cache theory directly, or ask Vector's lane whether a client-side
   fallback fetch is an intentional trade-off they've already made (vs. an oversight).
   **Update, 2026-08-25 — new direct evidence, still short of full confirmation.** AWS credentials
   were live this session, which the note above said would be needed. `ecs:DescribeServices` shows
   `enableExecuteCommand: false` on `blackout-production-web`, so literal per-task `exec` genuinely
   isn't available here (confirms, doesn't just repeat, the earlier note) — but two other checks
   were possible and both corroborate the hypothesis:
   1. **Live task topology**: `blackout-production-web` runs **8 tasks**, all `HEALTHY`, with ages
      ranging from **1.8 to 51.6 minutes** at time of check — direct proof that with 8 independently
      warming processes and this much churn, a request landing on a task under ~2 minutes old is a
      routine, expected event, not an edge case.
   2. **Source confirmation**: `vector-snapshot.ts`'s `stateByTicker` is a plain module-level `Map`
      (`state(ticker)`, line ~126) — genuinely process-local, exactly as inferred, with zero
      cross-instance backing. The SAME file documents an ALREADY-FOUND-AND-FIXED instance of this
      exact failure mode on a sibling code path: `getVectorGexWallsForHorizon`'s `"all"` branch has
      an explicit "Cold-task safety net" comment describing the identical symptom — "a member
      toggling the DTE control to All would watch the beads/walls blank out intermittently
      depending on which task the request lands on" — measured live 2026-07-12/07-13 and fixed with
      a multi-layer fallback (prime → Redis rail-tail → chain recompute). That fix does not cover
      the regime banner's own read path (`liveGexWalls()`/`liveGammaFlip()`, fed by the SSE stream,
      not this REST route), so it doesn't close this item — but it confirms the architecture-level
      risk is real, not speculative, and that this exact codebase has hit it before.
   **Reconciling the "always absent across 16 states" evidence**: this update also explains why the
   original walkthrough saw the banner missing consistently across an ENTIRE run rather than
   flickering between present/absent — the SSE stream is one persistent connection per page load,
   so a session that happens to land on a cold task stays on that same task (and that task's
   coldness) for the run's whole duration, which is exactly the all-16-states pattern measured.
   **Still not filed as a confirmed finding**: this is strong structural and historical corroboration,
   not a literal per-task cache read — that would need `enableExecuteCommand: true` (not this
   service's current config) or task-level application logging this sandbox can't add. Next step
   unchanged: Vector's owning lane decides between a cross-instance-consistent cache backing or a
   client-side self-heal fetch, per this file's own boundary rule against guessing that unilaterally.

10. **[ANSWERED, 2026-08-24 — confirmed benign, no fix needed] Thermal mobile GEX matrix — 5
    measured text collisions, root-caused as the opaque sticky-header-over-scrolled-row pattern.**
    `thermal-interaction-audit.cjs` (live RTH, 430×932) measured 5 physical text-leaf collisions on
    the GEX matrix table: `"Strike" ∩ "773"` (23×10px), `"Aug 25" ∩ "+$9.6M"` (47×17px),
    `"Aug 25" ∩ "+181%"` (29×10px), `"Net flow" ∩ "$484.9M"` (60×17px, and again at 60×3px — two
    overlapping pairs at the same header). Live geometry re-check (2026-08-24, off-hours):
    scrolled the matrix's own internal scroll container (`.gex-matrix-scroll`, `overflow-y:auto`,
    the sticky `<thead>`'s actual scrolling ancestor) and measured a real body row's rect
    (`y: 89.6–122.1`, strike `885`) physically intersecting the sticky `<thead>`'s rect
    (`y: 90.1–144.6`) — i.e. exactly the shape the harness's own collision detector flags, and
    exactly what happens on any table with `position: sticky; top: 0` headers over a scrolling
    body. `GexHeatmap.tsx`'s `<thead>` carries an explicit **opaque** background
    (`sticky top-0 z-20 bg-[#08080e]`, the app's solid void-black), so a row scrolled underneath it
    is fully covered, not rendered as garbled overlapping text a user would actually see — the
    harness measures raw DOM rect intersection, which cannot distinguish "hidden behind an opaque
    layer" from "visibly garbled," so it correctly flags the geometry but the visual result is the
    ordinary, intended behavior of any sticky table header. This is the same benign shape this
    harness's own top-of-file history already documented for Thermal desktop — now confirmed on
    mobile too with live measured rects, not just pattern-matched. Closing as answered rather than
    a defect; no fix needed. (The 1 clipped text leaf / 1 sub-24px `"Skip to content"` tap target
    noted in the same run were not re-investigated — low-severity and very likely the same
    visually-hidden accessibility skip-link hypothesized originally, not chased further.)

11. **[ANSWERED, 2026-08-24 — confirmed clean] Thermal desktop interaction audit — the earlier
    HARNESS failure was the deploy-window ChunkLoadError crash; a clean re-run outside that window
    found no product defects.** Originally, `thermal-interaction-audit.cjs` at 1440×900 threw
    `TypeError: Cannot read properties of null (reading 'scrollWidth')` inside its own
    `page.evaluate`, reading `document.documentElement.scrollWidth` /
    `document.body.scrollWidth` — properties that are normally never null once a page has loaded.
    The harness's OWN page-loaded gate had already passed (`loaded.thermal && loaded.matrix` both
    true) before this evaluate ran, consistent with a page-level crash/reload happening
    mid-measurement — very likely the same `ChunkLoadError` root cause found and fixed the same day
    (`docs/audit/findings-staging/2026-08-24-chunk-load-error-critical-crash.md`), now that #2842
    (the chunk-error self-heal) has merged. **Re-ran isolated, outside any deploy window, 2026-08-24
    off-hours:** `PAGE LOADED in 10804ms`, `routed 114 ok / 0 fail`, `body horizontal overflow: 0px`,
    `0 elements past viewport`, `0 console errors`. Two low-severity, already-understood
    observations, not new findings: 7 text collisions matching the exact opaque-sticky-`<thead>`
    pattern confirmed benign for mobile in item 10 (same table, same shape — `"Strike" ∩ "773"`,
    `"Net flow" ∩ "$482.2M"` ×2, etc.), and the same `"Skip to content"` `1×1` accessibility
    skip-link already hypothesized as intentionally hidden, not a real tap target. Desktop Thermal
    interaction coverage is clean; closing this item.

12. **[DONE, 2026-08-24] Platform-wide `ChunkLoadError` during a deploy could crash any page to a
    dead-end "CRITICAL ERROR" screen — found via a Thermal interaction-audit run, fixed the same
    day.** Not Thermal-specific — surfaced there by coincidence of timing (a live deploy window),
    but the fix is in the shared root/route error boundaries and applies to every route. Both
    `global-error.tsx` and `route-error-boundary.tsx` now detect a `ChunkLoadError` and perform one
    guarded `window.location.reload()`, self-healing a client stuck on a stale chunk manifest from
    before the deploy rotated instead of leaving it on a manual "Try again." See
    `docs/audit/findings-staging/2026-08-24-chunk-load-error-critical-crash.md`.

13. **[FIXED, 2026-08-25 — root-caused to four distinct components, three real fixes + one
    confirmed audit-tool false positive] Meridian earnings detail — 26 interactive controls under
    the 24px tap-target minimum, confirmed on both desktop and tablet.** `meridian-interaction-audit.mjs`
    (live, isolated runs, 2026-08-24) measured real `button`/`a[href]`/`[role=button]` elements below
    24px in both axes across three tabs: **Report** (10 — wall/pin rows `470x20`/`561x20`, five
    `18x18` intel-source badges: HELIX flow, dark pool, thermal nodes, Vector expected move, news &
    catalysts), **Estimates** (6 — analyst price-target/rating dots, all `8x8`), **Positioning**
    (10 — same wall/pin rows plus GEX-strike pills, `301x20`/`561x20`). Same shapes on desktop
    1440×900 and tablet 1024×1100, so this isn't a viewport-specific squeeze — it's the panel's
    base row/badge sizing. Root-caused each: (1) `MeridianStructureLadder`'s wall/pin rows — a real
    undersized control, height was pinned to 20px and coupled to a collision-resolver constant;
    raised to 24px, the resolver constant derives from it automatically. (2) `MeridianStrikeProfile`'s
    GEX-strike pills — a real undersized control, no coupling; given `min-height: 24px`. (3)
    `MeridianOrbital`'s 18×18 intel badges — **not a defect**: they already carry a deliberate
    invisible `::after` hit-area pad (26×26) so the visually-meaningful orb size doesn't have to be
    inflated; `getBoundingClientRect()` can't see a pseudo-element's painted area, so the audit
    flagged an already-correct control. Live-verified the pad genuinely extends the clickable area
    with a minimal Playwright reproduction (click 12px from center, outside the 9px visible circle,
    registered). (4) `MeridianTargetRail`'s 8×8 analyst dots — **not an undersized control, a
    non-control**: both current call sites render them as `disabled` buttons (no `onTargetClick`
    passed), and a disabled button can never be activated by any means, so no size would make it
    usable; changed the no-handler path to render a plain `<span>` instead of interactive markup
    for a control that can never be controlled. See
    `docs/audit/findings-staging/2026-08-25-meridian-earnings-tap-targets.md` for full evidence,
    fix rationale, and regression coverage (119 meridian tests + tsc green). Not yet deployed/
    live-verified against production — that's the natural post-merge follow-up.

14. **[ANSWERED, 2026-08-25 — confirmed working, the original harness finding was a stall, not a
    defect] Meridian tablet deeplink — selecting an event DOES change the URL.**
    `meridian-interaction-audit.mjs`'s original tablet pass measured the desk's URL still bare
    after opening an earnings event, but a static code trace said the opposite (`MeridianDesk.tsx`
    → `meridian-deeplink-core.ts`, wiring reads correct by inspection, with its own dedicated unit
    test). A first live re-check probe timed out waiting for the row to appear (a known
    cold-timeline-fetch stall) and settled nothing either way. **Re-ran with a longer row-wait
    (60s) and a direct before/after URL comparison:** `url before:
    https://blackouttrades.com/meridian`, `url after click:
    https://blackouttrades.com/meridian?event=earnings%3AGRRR%3A2026-08-24` — the URL correctly
    carries the selected event. Confirms the static trace was right and the original harness
    finding was a false negative caused by the cold-fetch stall (the click landed on a
    not-yet-fully-mounted row, or the harness's own timing raced the same stall this map already
    documents for Meridian's desktop timeline fetch), not a real product defect. No code change.

15. **[ANSWERED, 2026-08-24 — confirmed deploy noise, no fix needed] Largo `/terminal` —
    "Pricing"-click chunk 404s did not reproduce outside a deploy window.** `UI-UX-MAP.md` §8: an
    isolated `live-ui-interaction-audit.mjs` run had measured `webpack-*.js` / `app/error-*.js` /
    `app/global-error-*.js` all 404ing after clicking "Pricing", landing inside a confirmed active
    deploy window (this session's own doc-PR merges triggering back-to-back
    `ecr-push-production.yml` runs). Re-ran the identical command once `ecr-push-production.yml`
    showed no `pending`/`in_progress` run: `exercising 20 of 20 controls`,
    `[PASS] every exercised control did something` — clean, including the "Pricing" click. Confirms
    the original observation was the same deploy-window `ChunkLoadError` root cause already fixed
    in #2842, not a separate residual gap in its self-heal reload. No code change; closing.

16. **[DONE, 2026-08-24] `live-ui-interaction-audit.mjs` could mislabel or misattribute a "DEAD
    control" once ANY earlier click restructures the page's DOM — FIXED.** A post-BACK-recovery-fix
    re-run of `/nighthawk` (desktop) reported `[FAIL] 1 DEAD control(s) — click changed nothing
    observable {"dead":["WATCH 0"]}`. Investigated directly: an isolated single click on the real
    "WATCH 0" button (`.nh-deck-filtbtn`, Swing lane's WATCH-section filter) from a fresh page load
    produces a real, measurable change — interactive-control count dropped **31 → 16**. Not a Night
    Hawk defect. **Root cause:** `safeControls()` stamps every matched element's `data-audit-idx`
    fresh, by DOM traversal order, each time it runs — including the re-stamp the URL-changed
    branch triggers after ANY click that restructures the page (a tab switch, a filter, a route
    change). The outer loop iterated over the ORIGINAL, pre-run `controls` array captured once
    before the loop started, so once one control's click caused a re-stamp (the "0DTE" engine tab,
    index 0, switches the entire rendered section via `router.replace()`), every SUBSEQUENT
    `ctl.idx` in that stale array could resolve to a DIFFERENT physical element than the one
    `ctl.label` described. **Fix:** the outer loop is now a `while` over a `queue`/`qi` pair that
    gets REPLACED (not just re-stamped in place) by both re-stamp branches, so `qi` never indexes
    into a list that isn't the one it came from; a separate `exercised` counter preserves the
    original `MAX_CONTROLS` budget across any number of re-stamps. Live-verified: a clean re-run of
    `/nighthawk` after the fix reports `[PASS] every exercised control did something` — the "WATCH
    0" false positive does not reproduce, and no regression from the BACK-recovery fix (#2851) was
    introduced. See `docs/audit/findings-staging/2026-08-24-live-ui-audit-stale-control-index.md`.

---

## Declined / deferred

*(none yet)*
