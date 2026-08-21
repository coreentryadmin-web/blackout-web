# Lane brief — Thermal

**Launch as a remote session** with tags `fleet:blackout`, `lane:thermal`, `role:lane`.
See `docs/agents/FLEET.md` for why the fleet is structured this way.

> **Read `docs/agents/briefs/_COMMON.md` first — it is part of this brief.** It carries the seven
> standing rules, each of which exists because of a failure already paid for.

## Scope

The dealer-gamma matrix, the `/heatmap` surface, thermal compare cards, and every Thermal read exposed to Largo.

## The three rules most often gotten wrong

1. **Node 20 or it is not evidence** — `export PATH=/opt/nvm/versions/node/v20.20.2/bin:$PATH`.
2. **You cannot undraft your own PR, and that is expected.** REST silently no-ops; GraphQL is
   blocked for your session type. `agent-pr-release.yml` releases green drafts every 15 minutes.
   Open the PR, drive CI green, **stop**.
3. **Ask the coordinator in a PR comment, never the user.**

## Already merged — do not redo

**#2422** — the Thermal compare column read `bullish` off a SHORT-gamma matrix, 3 of 3 tickers inverted. The fix reads the typed `gamma_posture` instead of regex-scraping member-facing prose, and splits volatility onto its own axis because **dealer gamma is not directional** — short gamma amplifies a move in either direction, so `short -> bearish` asserts a direction the matrix never measured.

## Open on this lane

| PR | Title | Note |
|---|---|---|
| [#2425](https://github.com/coreentryadmin-web/blackout-web/pull/2425) | get_thermal_compare served a 16:00 close under an as_of of "now" | **Start here.** Has a real code conflict in `src/lib/largo/product-reads.test.ts` — needs a rebase onto latest `main`, not a merge resolution. |
| [#2431](https://github.com/coreentryadmin-web/blackout-web/pull/2431) | /heatmap claimed "Quote live" over SPY's 16:00 close at 20:41 ET | — |
| [#2438](https://github.com/coreentryadmin-web/blackout-web/pull/2438) | compare card reported net_premium 0 from an empty tape, and summed 48h of flow as if it were today | — |
| [#2441](https://github.com/coreentryadmin-web/blackout-web/pull/2441) | every expiry chip was a 19px tap target on a phone | — |
| [#2445](https://github.com/coreentryadmin-web/blackout-web/pull/2445) | the desk said LONG GAMMA while Largo said short — neither carried its expiry scope | — |
| [#2460](https://github.com/coreentryadmin-web/blackout-web/pull/2460) | three more positioning reads reached the model with no matrix time | — |

## Lane-specific context

Your lane's recurring defect is **a number served without the time or scope that gives it meaning** — a close stamped `now`, a posture with no expiry scope, a matrix with no age. Four of your six open PRs are that one shape.

## First moves

```bash
git fetch origin main
export PATH=/opt/nvm/versions/node/v20.20.2/bin:$PATH
node scripts/audit/agent-pr-sweep.mjs      # live state, never trust a remembered roster
```

Then read `docs/agents/FLEET.md` and `_COMMON.md`, and work your open PRs to green
one at a time, rebasing onto `main` after each merge.
