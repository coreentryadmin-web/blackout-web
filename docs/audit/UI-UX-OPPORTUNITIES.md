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

4. **[P2] SPX Slayer's Vector/Matrix/Intel single-panel tabs vs. a true multi-panel desktop
   layout.** Once `UI-UX-MAP.md` §2's P0 (blank left column) is root-caused, there's a design
   question sitting behind the bug fix: should desktop SPX Slayer show all three panels at once
   (matching the multi-panel composition `SpxDashboard.tsx` actually wires up) rather than
   single-panel tabs borrowed from the compact/native layout? That's a bigger call than the bug fix
   and belongs here until it's decided, not folded silently into the P0 fix PR.

5. **[P3] Night Hawk's empty state on a no-session day leaves ~45% of the mobile viewport
   blank.** (`UI-UX-MAP.md` §7.) Candidate content for that space: recent closed plays, a teaser
   for the other 3 engine tabs (Swings/Bangers/Legacy), or a countdown to the next session. Not
   urgent — it's not broken, just under-used space on a day with genuinely nothing to show.

6. **[P3] A shared chart-footer-legend component to prevent the overlap bug from recurring.**
   `UI-UX-MAP.md` finding #3 is confirmed on `/vector` mobile; whether it also affects `/dashboard`
   desktop (same `VectorChart.tsx` via `SpxVectorEmbed`) is still an open question pending a
   chart-loaded re-check. If it does turn out to affect both, the larger opportunity is auditing
   whether other embeds of the same component (any future ones) inherit the same footer-legend
   layout logic, so a fix to the shared component doesn't need to be re-verified per embed site by
   hand each time.

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

---

## Declined / deferred

*(none yet)*
