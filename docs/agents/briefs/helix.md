# Lane brief — HELIX

**Launch as a remote session** with tags `fleet:blackout`, `lane:helix`, `role:lane`.
See `docs/agents/FLEET.md` for why the fleet is structured this way.

> **Read `docs/agents/briefs/_COMMON.md` first — it is part of this brief.** It carries the seven
> standing rules, each of which exists because of a failure already paid for.

## Scope

HELIX flow and tape reads, the signal-outcome ledger, and every HELIX surface exposed to Largo.

## The three rules most often gotten wrong

1. **Node 20 or it is not evidence** — `export PATH=/opt/nvm/versions/node/v20.20.2/bin:$PATH`.
2. **You cannot undraft your own PR, and that is expected.** REST silently no-ops; GraphQL is
   blocked for your session type. `agent-pr-release.yml` releases green drafts every 15 minutes.
   Open the PR, drive CI green, **stop**.
3. **Ask the coordinator in a PR comment, never the user.**

## Already merged — do not redo

Nothing merged yet from this lane — **#2420** (expiry concentration dropped the 0DTE bucket and carried no session anchor) is in the batch PR #2462 and lands with it.

## Open on this lane

| PR | Title | Note |
|---|---|---|
| [#2428](https://github.com/coreentryadmin-web/blackout-web/pull/2428) | Largo aggregated a different tape than the desk, and quoted 7 days over 54 minutes | — |
| [#2430](https://github.com/coreentryadmin-web/blackout-web/pull/2430) | an unmeasured tape reached Largo as a measured 50/50 balance | A textbook rule-7 defect — absence published as measurement. |
| [#2434](https://github.com/coreentryadmin-web/blackout-web/pull/2434) | get_helix_derived answered "what is stacking now" with two days of whale prints | — |
| [#2437](https://github.com/coreentryadmin-web/blackout-web/pull/2437) | "62.5% win rate" hid that HELIX signals rarely reverse — they stall | — |
| [#2444](https://github.com/coreentryadmin-web/blackout-web/pull/2444) | adopt the Largo product contract C2/C3/C4/C5/C8 on the HELIX tools | Largest change on the lane; land the smaller fixes first so this rebases onto them, not the reverse. |
| [#2447](https://github.com/coreentryadmin-web/blackout-web/pull/2447) | signal-outcome ledger declared number and returned strings | — |
| [#2449](https://github.com/coreentryadmin-web/blackout-web/pull/2449) | an expiry reported a dte that depended on row order | **Conflicted** — needs a rebase onto latest `main` before anything else can happen to it. |

## Lane-specific context

Heavy internal overlap: #2420/#2428/#2430/#2434 all touch `helix-tape-analytics.ts`, and #2420/#2428/#2434/#2437 all touch `product-reads.ts`. **Land them one at a time, rebasing the next onto `main` after each merge** — parallel pushes here will just conflict.

## First moves

```bash
git fetch origin main
export PATH=/opt/nvm/versions/node/v20.20.2/bin:$PATH
node scripts/audit/agent-pr-sweep.mjs      # live state, never trust a remembered roster
```

Then read `docs/agents/FLEET.md` and `_COMMON.md`, and work your open PRs to green
one at a time, rebasing onto `main` after each merge.
