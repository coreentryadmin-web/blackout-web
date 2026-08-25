# MERIDIAN — CTO-depth audit, 2026-08-25

> **kind:** `AUDIT` (not a `FINDING` — this is the umbrella doc; genuine bugs found here get their
> own `docs/audit/findings-staging/` entries and PRs as they're fixed, cross-linked below).

Requested directly by the operator: "check entire Meridian... new features? enhancements? new
items? toggles? like everything... launch a deep dive massive CTO audit." Scope: every tab, live,
across a few different tickers, looking for bugs, missing context, toggle gaps, new-feature ideas,
and calibration honesty — not just polish.

**Method**: live product via `mintClerkPremiumSession` + `proxy-browser.cjs` (DKS earnings,
today's real high-impact print, 1440×1000 desktop), `meridian-exhaustive-field-audit.mjs`
(15 events, 2286 numeric leaves, data coherence), `meridian-interaction-audit.mjs` (behaviour/pixel
audit — overlap, clip, tap targets, deep-link, network, console), `meridian-earnings-data-inventory.mjs`
(fill-rate re-run at `importance>=4`), plus reading `MeridianDesk.tsx`, `meridian-viz.tsx`,
`meridian-spatial.tsx`, `meridian-catalyst-enrich.ts`, `meridian-earnings-analytics-core.ts` against
what rendered.

**Don't re-litigate**: `docs/audit/MERIDIAN-MAP.md` and `docs/audit/UI-UX-OPPORTUNITIES.md` item 13
already cover a full round of tap-target/deep-link findings from 2026-08-24/25 (wall/pin rows,
strike pills, revisions toggle, dark-pool prints — all fixed; orbit badges and the deep-link
"failure" both confirmed false positives). This pass independently reproduced both those
false-positive conclusions live (see §1) rather than re-opening them.

---

## 1. Confirmed non-issues from today's fresh interaction-audit run

Ran `meridian-interaction-audit.mjs --viewport=desktop` fresh. Two flags came back that
`UI-UX-OPPORTUNITIES.md` item 13/14 already explain — independently re-confirmed rather than
assumed still true:

- **P3 "6 controls under 24px" (Signal Orbit intel-source badges)** — already documented as a
  confirmed audit-tool false positive: these carry an invisible `::after` hit-area pad to 26×26 that
  `getBoundingClientRect()` can't see. Not re-tested pixel-by-pixel again here; taking the prior
  Playwright reproduction as settled.
- **P2 "deep-link does not restore the selected earnings event"** — re-tested directly: a **fresh
  navigation** to `https://blackouttrades.com/meridian?event=earnings%3ADKS%3A2026-08-25` (not a
  reload-after-click, a cold nav) restored the DKS earnings Summary tab correctly and fast (`Routed:
  222 ok, 0 fail`). `meridian-deeplink-core.ts`'s parse/serialize is correct by inspection too. The
  harness's specific check is `page.reload()` after an in-app click, which is a different code path
  (client-side reload under the CONNECT-tunnel's route interception) than a fresh URL nav — most
  likely a harness/proxy timing artifact, consistent with this file's own documented reload-timing
  traps. Not fixing the product; if this keeps flagging, the fix belongs in the harness's reload
  handling, not the app.
- Two `_next/static/chunks/*.js` 404s + matching console errors during the same run were very
  likely **deploy-transient**: `ecr-push-production.yml` run 32807738822 (the SPX-dock-fix deploy)
  was still `in_progress` at the exact time this audit ran. Not filed as a defect; the platform
  already self-heals this class of issue (`RouteErrorBoundary`'s `autoReloadOnceOnChunkError`, from
  `UI-UX-OPPORTUNITIES.md` item 12).

## 2. New findings — bugs

### 2.1 [P2] Quarterly Beat/Miss Streak panel is wired to the wrong data source and contradicts its neighbor

**Where**: History tab, "QUARTERLY BEAT / MISS STREAK" card, right below "EARNINGS TRACK RECORD"
and "BEAT RATES" (which show real data for the same ticker on the same page).

**Symptom** (live, DKS, 2026-08-25): the streak card reads *"No printed quarters on record for
DKS."* two panels below "EARNINGS TRACK RECORD — 7 / 8 EPS beats" and "BEAT RATES — 88%/88%/88%
over 8 graded prints" for the exact same ticker. A member reading top-to-bottom sees the same
question answered two different ways in the same screen.

**Root cause**: `MeridianEarningsHistoryPanel.tsx:91` feeds `MeridianBeatStreak`
(`buildBeatMissStreak` in `meridian-earnings-analytics-core.ts:253`) from `analyticsRows`, which
traces back to `data.earnings_analytics_rows` — built by `buildEarningsAnalyticsRows` in
`meridian-benzinga-earnings-core.ts` from Benzinga's **forward-looking earnings-calendar window**
(`loadBenzingaEarningsBundle`'s `window_rows`, the market-wide days-ahead calendar). That dataset
is who's-reporting-when, not historical prints — `buildBeatMissStreak` filters for
`hasPrinted(row)`, which this row shape essentially never satisfies for a name outside the
immediate calendar window. Meanwhile "Earnings Track Record" and "Beat Rates" on the *same tab*
correctly read `enrichment.print_history`, the real per-ticker historical print array (8 real
rows, visibly rendered a few pixels above).

**Fix** (not yet made — flagging with a clear direction rather than rushing a shape-mismatched
adapter): `MeridianBeatStreak`/`buildBeatMissStreak` should read `enrichment.print_history`
converted to the `EarningsAnalyticsRow` shape it expects (`ticker`, `date`, `estimated_eps`,
`actual_eps`, `eps_surprise_pct`, etc.), not the calendar-window rows. `print_history`'s exact
field names need confirming against `meridian-earnings-enrich.ts` before writing the adapter —
worth its own small `fix/` PR rather than a guess.

### 2.2 [P3] History tab shows the same 8-print track record three times, in three formats

**Where**: History tab only. "EARNINGS TRACK RECORD" (bar chart + %), "PRINT TRACK · EST VS ACTUAL"
(plain list, same 8 dates), and the blue "TRACK RECORD" one-line callout — all state the same
"7/8 EPS beats · 88% rev beats of 8 · avg reaction -2.5%" fact, plus "BEAT RATES" restates the
percentages a fourth time. Not wrong, just redundant — a reader has to notice three renderings of
one number are the same rather than three independent facts. Report tab *also* repeats the same
bar-chart card, which is reasonable there (a summary digest referencing history) but the
triplication **within** History itself is the part worth trimming: collapse the plain-text
"PRINT TRACK" list into the bar-chart rows (it's already showing EPS-vs-actual per row) or fold it
behind a "show raw values" disclosure.

### 2.3 [P3] "GUIDANCE" catalyst-brief tag is Benzinga's news-channel label, not actual corporate guidance

**Where**: Report tab, "CATALYST BRIEFS." Every item on DKS read `GUIDANCE · <analyst
upgrade/downgrade/PT-change headline>` — e.g. "GUIDANCE · JP Morgan Maintains Overweight on Dick's
Sporting Goods, Lowers Price Target to $245." None of the six were management's own forward
outlook; all were sell-side analyst actions.

**Root cause**: `shapeCatalystBriefs` (`meridian-catalyst-enrich.ts:101`) passes through Benzinga's
own `type` field verbatim for anything tagged `guidance` in Benzinga's channel taxonomy — that
channel is evidently broader than the word "guidance" implies to a reader. Corroborating evidence:
today's fill-rate re-run (`meridian-earnings-data-inventory.mjs --min-importance=4`) puts the
*actual* `enrichment.corporate_guidance` field at **0% fill (RARE)** — the real guidance field is
essentially always empty, while the mislabeled Benzinga-channel tag is what members actually see.
Not a BlackOut-introduced fabrication (Benzinga's own taxonomy), but the raw upstream label
reaching the UI unedited is misleading. Small fix: rename the displayed tag for this channel (e.g.
"ANALYST" or "COVERAGE") rather than passing Benzinga's internal category name straight through, or
drop analyst-action items from the `catalyst_briefs` bucket entirely since `analyst_revisions`
already covers them elsewhere on the same tab.

## 3. Missing context / calibration

- **Sector peers panel is honest but structurally empty in the observed cohort.** Positioning tab's
  "SECTOR PEERS" card correctly states *"only 0 peers reporting with a comparable number — too few
  to rank against"* rather than fabricating a rank — good, matches the Largo-contract absence
  discipline. But it then lists 6 peers (BBWI, ULTA, TITN, BBW, SPWH, WOOF) each showing only a
  date and a bare "—". As shipped this card can't currently do anything a member couldn't get from
  an earnings calendar. See §5 idea 1 for what would make it earn its space.
- ~~Halo dimension scores are inconsistently populated~~ **CORRECTED, same day — not a defect.**
  Pixel-level re-examination of the same screenshot (2x crop, `dims-crop.png`) shows the glyph
  originally read as a bare "○" is a real, correctly-rendered **`0`** — `dimensionRollup` computes
  a genuine 0-100 intensity for every dimension with contributing signals, and STRUCTURE/SENTIMENT
  scored a real 0 (net-zero: their bullish and bearish signals cancelled exactly), which
  `MeridianRing` renders as a near-invisible arc plus a small `0` digit, per its own "no arc at all
  when there is no value — an empty ring is honest, a full grey one is not" comment. `v === null`
  renders "—" here, never a bare circle; this dimension had a real value, just a small one. Only
  the visual point stands, softened: a `0` at this size/weight can read as "no score" even though
  it means something specific (perfect signal disagreement, mirroring the halo's own "agreement"
  concept) — worth a slightly bolder `0` or a one-word "balanced" label if this comes up again, but
  not the calibration-honesty issue originally flagged.
- **Financials context fields are RARE even at importance>=4** (`intel.financials.pe_ratio`,
  `price_to_sales`, `roe_pct`, `price_target_upside_pct` all 0% in today's re-run,
  `min-importance=4`, same cohort where `dark_pool`/`thermal` are 8-10/10 filled). Worth a
  provider-side check: is this a real data gap, or a field-mapping miss like the historical
  `barLimitForWindow` and reaction-anchor bugs this repo has hit before?

## 4. Toggle / customization gaps

- **No density/default-tab preference.** Every earnings event always opens on Summary; a member
  who always reads Positioning first re-clicks it every single time, every single event, with no
  way to set a default tab.
- **No user-configurable Catalyst-lane default filter.** `filter=all` is the hardcoded default on
  every visit; a member who only ever cares about `IMP >=4` mega-cap earnings re-clicks that chip
  every session. Since the desk already persists filter state to the URL for a single session
  (`meridian-deeplink-core.ts`), a *remembered* default (localStorage, not account-wide) would be a
  small, high-value add.
- **Sector-peers cohort is fixed, not user-adjustable.** If §5 idea 1 below gets built, whether the
  peer set is auto-detected sector or a user-editable watch-group is itself a toggle worth deciding
  explicitly rather than defaulting silently.

## 5. New feature ideas (not yet scoped into a PR — operator input wanted, see §6)

1. **Sector-peer reaction history, not just a peer calendar.** Positioning's Sector Peers card
   currently only lists upcoming peer print dates. The product already computes a per-ticker
   historical reaction distribution (History tab's Implied-vs-Realized, Track Record). Extending
   that same computation across the peer list — "how did BBWI/ULTA/SPWH react to their last 4
   prints" — turns an inert calendar into the pattern-matching context a member actually wants
   before an earnings trade: does this whole sector tend to gap the way this name does.
2. **A concrete options-play suggestion, not just a wall-probability abstract.** (Carried over from
   the operator's earlier ask, not yet designed — flagging here so it isn't lost in this audit's
   scope.) Summary's CALL/PUT cards currently read "15% implied chance of closing above 210 (call
   wall)." Turning that into a specific contract idea (ticker/strike/expiry) needs a real design
   decision on strike/expiry selection logic and whether the "% chance" can be honestly presented as
   more than a repackaged wall-implied-probability — still owed as a separate proposal.
3. **Cross-product tie-ins are already richer than a plain link — worth knowing before proposing
   more.** Positioning's "THERMAL KING NODES" and "HELIX FLOW" cards already pull real inline data
   (GEX by strike, net premium/side) rather than just linking out — the "Jump to desk" row's plain
   links are for the OTHER four products (Vector, Night Hawk, SPX), which don't get an inline
   preview yet. Extending the same inline-card treatment to Vector (recent flow/beads for this
   ticker) would be a natural, consistent next step rather than a new pattern.
4. **A per-ticker "watch this print" mechanism.** Meridian already has a Watchlist filter chip; there
   is no way to get notified (push/email, whichever channels the product already has elsewhere) when
   a *specific* watched print's flow/structure meaningfully shifts before the bell. Given "WHAT
   CHANGED — Read is firming over 4d (+5)" is already tracked and rendered on Summary, the
   underlying signal exists; only the notification hook is missing.

## 6. Decisions made and shipped (operator: "drive everything autonomously")

1. **§2.1, Quarterly Beat/Miss Streak data-source bug — FIXED.** `printHistoryToAnalyticsRows`
   adapter added to `meridian-earnings-analytics-core.ts`; `MeridianEarningsHistoryPanel` now feeds
   `buildBeatMissStreak` this ticker's real `print_history` instead of the market-wide forward
   calendar window. Tests added (`meridian-earnings-analytics-core.test.ts`).
2. **§2.2, History-tab triple redundancy — partially fixed.** The exact-duplicate "Track record"
   banner (verbatim repeat of the Summary card three lines above it) removed from
   `MeridianEarningsTabs.tsx`. Left the bar-chart vs. plain-list formats as-is — they overlap in
   scope but the plain list carries raw EPS actual/estimate values the bar chart doesn't show, so
   collapsing it further is a real design call, not a duplicate-string cut; parked for a follow-up
   pass if it still reads as noisy once the one confirmed duplicate is gone.
3. **§2.3, "GUIDANCE" mislabel — FIXED.** `looksLikeAnalystAction` (new, `meridian-feed-text.ts`)
   filters Benzinga "guidance"-channel catalyst briefs whose title is really a price-target/rating
   action out of `catalyst_briefs` — that headline is already shown correctly under
   `analyst_revisions` elsewhere on the same tab. Reuses `shapeAnalyst`'s existing keyword
   vocabulary rather than inventing a second one; deliberately narrower (price target / rating tier
   / upgrade-downgrade / coverage-initiation only) so a real "raises guidance" headline is never
   caught by the same bare verb an analyst note uses for "raises price target." Extracted the pure
   shaping logic into a new `meridian-catalyst-enrich-core.ts` (the original file's `import
   "server-only"` throws unconditionally under `tsx --test`, so nothing in it was unit-testable —
   this is the same core/enrich split every other Meridian data layer already uses). Tests added.
4. **§3, halo "○" — CORRECTED, not a bug.** Re-examined the source screenshot at the pixel level:
   it's a real, correctly-rendered `0` (a genuine net-zero intensity — bullish and bearish signals
   in that dimension exactly cancelling), not a missing-score placeholder. No code change; the
   audit finding itself was wrong and is struck through in §3 with the correction.
5. **§5 idea 1, sector-peer reaction history — built.** See §7 below.
6. **§5 idea 2, options-play-suggestion card — DESIGNED, deliberately NOT built this pass.** See §8
   below for why: `MeridianEarningsSummaryPanel.tsx`'s CALL/PUT card carries an explicit, already-
   considered guard against exactly the thing this feature would add ("nothing here knows a
   contract price, so 'chance of profit' would be invented"). Turning `idea.impliedProb` into a
   labeled contract suggestion without breaking that guard is a real design problem, not a
   presentation change — building it under time pressure risked shipping the fabrication the
   existing code was written to avoid. §8 lays out the honest version instead of a rushed one.

---

## 7. Sector-peer reaction history — built

Turns the Positioning tab's Sector Peers card from a peer CALENDAR (dates only, most rows a bare
"—") into something that also answers "how does this whole sector tend to react."

**What it adds**: for each peer in the cohort (capped at `MAX_PEER_REACTION_TICKERS = 6`), a
second line under the existing implied-move row — `avg +1.2% · 62% beat (n=6)` — computed from
that peer's own settled print history, or nothing at all when a peer has no usable prints (never a
fabricated 0%).

**Why it's honest, not a new invented stat**: it reuses the SAME functions the subject's own
History tab is built from (`settledReactions`, `beatSeries`/`beatTally` from `meridian-viz-core.ts`)
via a new `summarizePeerReaction` in `meridian-sector-core.ts` — a peer's number and the subject's
own number are guaranteed to mean the same thing, because they're computed by the same code, not a
parallel implementation that could quietly drift.

**Why it's a new server route and not just more client computation**: the data (`print_history`)
doesn't exist for peers on the client at all — only the subject's own detail fetch loads it. Reused
`loadMeridianEarningsPrintHistory` (the exact function `print_history` already comes from) per
peer, in a new `meridian-peer-reactions.ts` loader and `GET /api/market/meridian/peer-reactions`
route, rather than inventing a second earnings-history pipeline.

**Cost control**: each peer fetch is a real Benzinga calendar call plus several Polygon minute-bar
reaction lookups, so this is deliberately capped (max 6 peers per request, `PRINTS_PER_PEER = 4`)
and cached hard (6h per-ticker `serverCache` TTL — a peer's historical print record cannot change
intraday). A single peer's fetch failing (rate limit, no calendar entry) degrades to "no data" for
that one peer rather than failing the whole cohort.

**Not yet live-verified against production** — this sandbox cannot deploy or hit the live route
end-to-end; verified via `npx tsc --noEmit`, the full unit suite (`meridian-sector-core.test.ts`,
21 tests covering `summarizePeerReaction` directly), and reading the actual request/response shapes
against the existing `lookup` route's established pattern. The natural post-merge follow-up is a
live check of `/meridian` Positioning tab post-deploy, same as every other UI change in this doc.

**Files**: `meridian-sector-core.ts` (`summarizePeerReaction`, `MAX_PEER_REACTION_TICKERS`),
`meridian-peer-reactions.ts` (new), `src/app/api/market/meridian/peer-reactions/route.ts` (new),
`MeridianPeerCohortPanel.tsx` (SWR fetch + row rendering), `desk-app.css` (`.mpeer-reaction`).

## 8. Options-play-suggestion card — design, not yet built

The operator's original ask (before this audit): turn the Summary tab's CALL/PUT cards from an
abstract wall-probability into something like `NVDA 225C 09/02 — 15% chance — reasoning`.

**Why this wasn't rushed into code today.** `MeridianEarningsSummaryPanel.tsx`'s `IdeaCard`
already carries a deliberate, already-considered guard, in its own comment: *"The headline number
is a DISTRIBUTION statement... nothing here knows a contract price, so 'chance of profit' would be
invented."* `idea.impliedProb` is the options-implied probability the UNDERLYING closes past a
level (the call/put wall) — a real, market-derived number. A specific contract (a strike, an
expiry, a premium) has its OWN payoff curve: time decay, the actual premium paid, assignment risk
near the wall. "15% chance of closing above 210" and "15% chance this 225C is profitable by 09/02"
are different claims, and conflating them is exactly the kind of fabricated-certainty the Largo
contract's confidence rules and this file's own comment both exist to prevent.

**What an honest version needs, concretely** (this is the design, not yet implemented):
1. **Strike/expiry selection is a real algorithm, not a guess.** The natural candidate: the SAME
   wall already computed (`idea.level`, sourced from `MeridianTargetRail`/dealer structure) as the
   strike, and the nearest listed expiry AFTER the print (the Positioning tab's Dealer Structure
   panel already shows this — "2026-09-18 expiry — 24d after the print" in the DKS screenshot).
   Both numbers already exist on the page; this is a lookup, not new data.
2. **The probability shown must be labeled for what it is** — "underlying closes past this level"
   — not "this contract is profitable." If a real contract-profitability number is wanted later,
   that needs the contract's actual premium/greeks from the options chain (Thermal/Vector already
   have chain access) and is a materially bigger feature, not a label change.
3. **Reasoning is already written** — the IdeaCard's existing `evidenceNet`/`historicalRate`/
   `invalidation` fields are the reasoning; the card doesn't need new copy, it needs the strike/
   expiry framing wrapped around what's already there.
4. **Disclaimer language** scales with how directive the new framing reads — a labeled contract
   idea reads as more of a "trade" than "15% chance of closing above 210" does, even holding the
   underlying math identical, so the existing "not a trade recommendation" language (already on
   Positioning's Play Read card) likely needs to move onto this card too, not just live nearby.

Recommend this as a small, separate `feat/` PR once reviewed — the strike/expiry wrapper is
mechanical, but item 2's exact wording is a real editorial decision worth a second look before it
ships, not a judgment call to make silently.

## 9. Additional live spot-checks, post-fix (2026-08-25, continued)

Broadened ticker coverage beyond DKS to stress-test edge cases, per the operator's follow-up
request to check "every field, every value" across the product.

- **INTU (mega-cap, importance 5)** — Summary tab clean. "Evidence is split 4.0 bull vs 3.0 bear —
  both sides shown, neither promoted" is exactly the calibration-honest verdict language the
  product is supposed to produce when the book genuinely disagrees with itself. No defects found.
- **SLQT (importance 1, spot $0.83, thin market)** — surfaced something that LOOKED like a bug and
  turned out to be correct, deliberate behavior worth recording so it isn't re-flagged later: the
  PUT idea card read "below 0.21 · implied move edge" while "Levels to Watch" listed `PUT WALL: 1`
  — a different number, and 1 is actually ABOVE spot (0.83), not below it. `pickLevel()`
  (`meridian-summary-core.ts:241`) explicitly guards against exactly this: a wall only qualifies as
  a put TARGET if it sits on the correct side of spot (`wall < spot` for a put) — SLQT's put_wall
  fails that check, so the function correctly falls through to the implied-move edge instead of
  presenting a nonsensical "get below a level that's currently above you" idea. The code comment
  cites the exact prior incident this guard was built for (BHP, wall on the wrong side / too near /
  too far, with real numbers). **Not a Meridian bug** — if anything, a genuine open question one
  layer up: why is Thermal's `put_wall` for SLQT sitting above spot at all (that's a Thermal-lane
  question, not filed here).
- Both checks required a fresh Clerk session mint — the temp session from the DKS/INTU pass had
  aged past the ~30min sweep window mid-audit, which manifested as `ERR_CONNECTION_RESET` on every
  navigation and was briefly mistaken for a stuck deploy (ECS was independently confirmed healthy,
  8/8 tasks, `rolloutState: COMPLETED`, via `boto3` before the real cause — a stale session — was
  found). Noted here as a harness gotcha for whoever runs this audit's commands next: mint a fresh
  session per capture batch, not once for a whole long-running audit.

---

## 10. Largo integration — live probe, 2026-08-25

Per the operator's follow-up: "Largo should be able to answer everything on Meridian." Ran real
questions against the LIVE `POST /api/market/largo/query` endpoint (production, admin temp
session, `mintClerkPremiumSession`), not a simulation.

**Q1: "What is the DKS earnings setup today according to Meridian?"** — Strong, correct, fully
cited answer (21.7KB, 31.6s). Every number cross-checks against what this audit observed live in
the product: 7/8 EPS beats, 88% rev-beat rate, -2.5% avg reaction, $206K bullish net flow, no
gamma flip, call/put walls at 200/160, JPM target cut to $245. Properly hedged risk section (short
gamma → moves extend, not dampen; beat-but-sell pattern flagged explicitly). No fabrication
observed — this is Largo working as intended on a Meridian question.

**Q2: "Which sector peers is DKS being compared against, and how have they historically
reacted?"** — Largo called `get_meridian_event` (confirmed via `tools_used` in the response) but
still answered *"There's no live peer-comparison panel for DKS beyond broad-market RS"* and fell
back to generic `get_peer_ticker_compare`/`get_peer_rs` tools instead of Meridian's own
sector-matched cohort. **Root cause, confirmed by reading the code, not guessed**:
`get_meridian_event` (`run-tool.ts:1694`) returns `loadMeridianEventResponse(id)` — the exact
single-event detail payload the UI's `/api/market/meridian/event` route serves. The Sector Peers
cohort (`MeridianPeerCohortPanel.tsx`'s `buildCohortForItem`, and this audit's own new §7 peer
reaction history) is computed **client-side**, from the full loaded timeline (`allItems`) filtered
to same-SIC-major-group peers — it is a cross-event computation that has never been part of any
single event's API response, so no tool call Largo can make today reaches it. **This is not a
fabrication** (Largo correctly said "no panel" rather than inventing peer data) but it is a real,
confirmed integration gap: Meridian's richest earnings-comparison feature is invisible to Largo.

**What closing this gap would take** (not built this pass — a new tool, real scope, not a quick
fix): a new Largo tool (e.g. `get_meridian_peer_cohort`) that takes a ticker/event id, loads the
surrounding timeline window server-side, and returns `buildSectorCohort` + (now that #2884 has
shipped it) `summarizePeerReaction` for the matched peers — reusing those exact pure functions,
not reimplementing the classification. Small, well-scoped, but genuinely new surface, so flagged
here rather than built silently.

**Q1 vs Q2 also incidentally corrected a suspected finding from this same probe**: an earlier
read of Q2's raw HTTP response looked truncated mid-sentence ("2026-05-27 −5.97% · 2026-03-",
cut off) across three different JSON serializations of the same text. Re-ran with the full
response saved to a file instead of a truncated terminal echo, and the answer was complete and
well-formed end to end — the apparent truncation was an artifact of this audit's own
`console.log(text.slice(0, 3500))` display line, not a real API defect. Recorded so the same false
positive doesn't get re-investigated from a stale log.

---

*Live findings above are the actual product state as of 2026-08-25, ~04:30 UTC, ticker DKS
(2026-08-25 earnings, high impact). Screenshots not committed (contain a live temp-session
render only); reproducible via the commands in each section.*
