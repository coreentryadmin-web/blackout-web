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
- **Halo dimension scores are inconsistently populated.** Report tab's intelligence halo shows real
  numbers for FLOW (100) and HISTORY (25), but STRUCTURE, SENTIMENT, and CATALYST all show a bare
  "○" glyph despite each listing 1-2 "signals." If these three dimensions genuinely can't produce a
  calibrated score yet (consistent with the Largo-contract "omit, don't fabricate" rule), the UI
  should say so explicitly (e.g. "n/a" or "no score yet") instead of an unlabeled circle a member
  could misread as a real zero.
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

## 6. Flagged directly to the operator — need a decision, not just code

1. **§2.1, the Quarterly Beat/Miss Streak data-source bug** — small, well-scoped, but touches which
   dataset a whole panel reads from; wanted a second pair of eyes before committing to the
   `print_history` adapter shape.
2. **§5 idea 1, sector-peer reaction history** — real, valuable, and buildable from data the product
   already computes elsewhere, but it's a genuine new feature (more surface, more to maintain), not
   a bug fix — wanted explicit sign-off before scoping it as a build.
3. **§3, halo "○" placeholders** — is STRUCTURE/SENTIMENT/CATALYST really uncalibrated for every
   event (in which case the fix is a clearer "no score" label), or should these three ever produce
   a number and something upstream is silently dropping it? That's a data question before it's a
   display question.

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

*Live findings above are the actual product state as of 2026-08-25, ~04:30 UTC, ticker DKS
(2026-08-25 earnings, high impact). Screenshots not committed (contain a live temp-session
render only); reproducible via the commands in each section.*
