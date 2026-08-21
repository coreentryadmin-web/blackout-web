# Lane brief — Night Hawk

**Launch as a remote session** with tags `fleet:blackout`, `lane:nighthawk`, `role:lane`.
See `docs/agents/FLEET.md` for why the fleet is structured this way.

> **Read `docs/agents/briefs/_COMMON.md` first — it is part of this brief.** It carries the seven
> standing rules, each of which exists because of a failure already paid for.

## Scope

The 0DTE board, the commit ledger, live marks and P&L, exit management, grading, and the Night Hawk edition.

## The three rules most often gotten wrong

1. **Node 20 or it is not evidence** — `export PATH=/opt/nvm/versions/node/v20.20.2/bin:$PATH`.
2. **You cannot undraft your own PR, and that is expected.** REST silently no-ops; GraphQL is
   blocked for your session type. `agent-pr-release.yml` releases green drafts every 15 minutes.
   Open the PR, drive CI green, **stop**.
3. **Ask the coordinator in a PR comment, never the user.**

## Already merged — do not redo

Nothing merged yet — **#2433** (track-record tool delivered 1.5% of itself) and **#2436** (edition tool cut off every play) are both in batch PR #2462 and land with it.

## Open on this lane

| PR | Title | Note |
|---|---|---|
| [#2439](https://github.com/coreentryadmin-web/blackout-web/pull/2439) | the payload scanner's --tools flag was documented and never parsed | — |
| [#2440](https://github.com/coreentryadmin-web/blackout-web/pull/2440) | the intraday read's only time anchor was a bare epoch — on a risk gate's freshness field | — |
| [#2443](https://github.com/coreentryadmin-web/blackout-web/pull/2443) | "RTH" was open-bounded only — after-hours prints polluted VWAP, day high/low and trend | — |
| [#2450](https://github.com/coreentryadmin-web/blackout-web/pull/2450) | three lane payloads dated themselves by a bare UTC instant — a session ahead after 20:00 ET | — |
| [#2452](https://github.com/coreentryadmin-web/blackout-web/pull/2452) | five of seven closed plays displayed a GAIN for a losing trade | **Highest severity open on any lane** — this is member-visible, money-adjacent, and wrong in the flattering direction. Land it first. |

## Lane-specific context

This lane is real-money-adjacent, so the bar is higher: prefer a fail-closed guard over a best guess, and never let a grading change ship without measuring its effect on past sessions (`npm run sim:0dte --grade=<date>`). `docs/audit/OUTCOME-GRADING-SPEC.md` maps every grader and which pairs are *intentionally* different views versus which are supposed to be identical.

## First moves

```bash
git fetch origin main
export PATH=/opt/nvm/versions/node/v20.20.2/bin:$PATH
node scripts/audit/agent-pr-sweep.mjs      # live state, never trust a remembered roster
```

Then read `docs/agents/FLEET.md` and `_COMMON.md`, and work your open PRs to green
one at a time, rebasing onto `main` after each merge.
