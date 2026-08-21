# Lane brief — Vector

**Launch as a remote session** with tags `fleet:blackout`, `lane:vector`, `role:lane`.
See `docs/agents/FLEET.md` for why the fleet is structured this way.

> **Read `docs/agents/briefs/_COMMON.md` first — it is part of this brief.** It carries the seven
> standing rules, each of which exists because of a failure already paid for.

## Scope

Wall rails, beads, expected move, pin forecast, the gamma magnet, and the Vector full-state read Largo consumes.

## The three rules most often gotten wrong

1. **Node 20 or it is not evidence** — `export PATH=/opt/nvm/versions/node/v20.20.2/bin:$PATH`.
2. **You cannot undraft your own PR, and that is expected.** REST silently no-ops; GraphQL is
   blocked for your session type. `agent-pr-release.yml` releases green drafts every 15 minutes.
   Open the PR, drive CI green, **stop**.
3. **Ask the coordinator in a PR comment, never the user.**

## Already merged — do not redo

**#2423** — Vector's fraction fields reached Largo as literal `0`. The BIE boundary called bare `roundFloats()` at the default 2dp, which quantizes any fraction-of-one to the nearest 1%: SPX's real `movePct` of `0.004006` served as `0`, so Largo answered "expected move 0.00%" while `/vector` showed 0.40%. It also fixed a live `dteDays: 0` that the engine itself defines as invalid, served alongside a non-null band.

## Open on this lane

| PR | Title | Note |
|---|---|---|
| [#2427](https://github.com/coreentryadmin-web/blackout-web/pull/2427) | pulse called a self-diff "stable", and reads shipped no age | — |
| [#2435](https://github.com/coreentryadmin-web/blackout-web/pull/2435) | full-state absence was indistinguishable from emptiness | Rule 7 exactly. |
| [#2451](https://github.com/coreentryadmin-web/blackout-web/pull/2451) | structure breaks carried a bare epoch across a 3-session seed | — |
| [#2459](https://github.com/coreentryadmin-web/blackout-web/pull/2459) | get_vector_full_state handed the model a bare null | — |

## Lane-specific context

`VECTOR_FRACTION_DP` in `vector-response-rounding.ts` is the shared precision map. The #2423 lesson is worth carrying: **a centralized fix is not adopted until every call site imports it** — that map existed specifically to prevent this class and still left the highest-leverage consumer on the broken default for two weeks. Grep its importers against every call site that serves the same numbers.

## First moves

```bash
git fetch origin main
export PATH=/opt/nvm/versions/node/v20.20.2/bin:$PATH
node scripts/audit/agent-pr-sweep.mjs      # live state, never trust a remembered roster
```

Then read `docs/agents/FLEET.md` and `_COMMON.md`, and work your open PRs to green
one at a time, rebasing onto `main` after each merge.
