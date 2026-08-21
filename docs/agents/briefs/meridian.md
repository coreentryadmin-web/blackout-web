# Lane brief — Meridian

**Launch as a remote session** with tags `fleet:blackout`, `lane:meridian`, `role:lane`.
See `docs/agents/FLEET.md` for why the fleet is structured this way.

> **Read `docs/agents/briefs/_COMMON.md` first — it is part of this brief.** It carries the seven
> standing rules, each of which exists because of a failure already paid for.

## Scope

Earnings (calendar, prints, reactions, pre-earnings packs), OpEx history, the macro timeline, and the Meridian UI surfaces.

## The three rules most often gotten wrong

1. **Node 20 or it is not evidence** — `export PATH=/opt/nvm/versions/node/v20.20.2/bin:$PATH`.
2. **You cannot undraft your own PR, and that is expected.** REST silently no-ops; GraphQL is
   blocked for your session type. `agent-pr-release.yml` releases green drafts every 15 minutes.
   Open the PR, drive CI green, **stop**.
3. **Ask the coordinator in a PR comment, never the user.**

## Already merged — do not redo

**#2424** — `get_earnings_calendar` answered "No upcoming date" for all 1,656 tickers. `callInternalApiRead` returns a transport *envelope* and the route body lives under `data`; the code tested `"earnings" in res` against the envelope, which is never true. It also fixed an unconditional `configured: true` that collapsed three distinct states (read failed / calendar unconfigured / genuinely no date) into one confident wrong answer.

## Open on this lane

| PR | Title | Note |
|---|---|---|
| [#2426](https://github.com/coreentryadmin-web/blackout-web/pull/2426) | prior-OpEx rows had a null SPX close and today's max pain on every date | In batch PR #2462 — lands with it, do not redo. |
| [#2432](https://github.com/coreentryadmin-web/blackout-web/pull/2432) | UW earnings numbers reached the model as unlabelled string fractions (100x misread on print reaction) | — |
| [#2442](https://github.com/coreentryadmin-web/blackout-web/pull/2442) | pre-earnings pack dropped the reaction, its basis and the can't-look signal | — |
| [#2446](https://github.com/coreentryadmin-web/blackout-web/pull/2446) | get_earnings served news ABOUT other companies, not this company's earnings | — |
| [#2455](https://github.com/coreentryadmin-web/blackout-web/pull/2455) | Meridian UI harnesses judged a micro-cap and read a lost session as a defect | Harness correctness, not product — but it gates trusting every other UI verdict on this lane. |
| [#2457](https://github.com/coreentryadmin-web/blackout-web/pull/2457) | dealer-structure ladder separated rows by less than a row height | — |
| [#2461](https://github.com/coreentryadmin-web/blackout-web/pull/2461) | print-history lookback was fixed at 420 days, so "last 8 prints" was never 8 | — |

## Lane-specific context

Two repo-documented traps live on your lane and have each cost months: **(1)** a Polygon aggregate `limit` must be DERIVED from the window — `sort=asc` means a too-small cap returns the OLDEST N and silently drops the recent end, which presents as "we don't have that data" rather than a truncated fetch (this is exactly #2461); **(2)** an earnings reaction must be anchored to the print's BMO/AMC timing — a post-close print's reaction is the NEXT session, and getting it wrong does not degrade the number, it inverts its meaning (measured 7.41% vs 3.01% on one real print).

## First moves

```bash
git fetch origin main
export PATH=/opt/nvm/versions/node/v20.20.2/bin:$PATH
node scripts/audit/agent-pr-sweep.mjs      # live state, never trust a remembered roster
```

Then read `docs/agents/FLEET.md` and `_COMMON.md`, and work your open PRs to green
one at a time, rebasing onto `main` after each merge.
