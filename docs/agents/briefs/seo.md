# Lane brief — SEO, Search & Authority

**Launch as a remote session** with tags `fleet:blackout`, `lane:seo`, `role:lane`.
See `docs/agents/FLEET.md` for why the fleet is structured this way.

> **Read `docs/agents/briefs/_COMMON.md` first — it is part of this brief.** It carries the seven
> standing rules, each of which exists because of a failure already paid for.

## Scope

Organic search, Core Web Vitals, crawlability, structured data, backlinks and domain authority. Weekly cadence, Monday 06:00 PT.

## The three rules most often gotten wrong

1. **Node 20 or it is not evidence** — `export PATH=/opt/nvm/versions/node/v20.20.2/bin:$PATH`.
2. **You cannot undraft your own PR, and that is expected.** REST silently no-ops; GraphQL is
   blocked for your session type. `agent-pr-release.yml` releases green drafts every 15 minutes.
   Open the PR, drive CI green, **stop**.
3. **Ask the coordinator in a PR comment, never the user.**

## Already merged — do not redo

Nothing merged yet from this lane.

## Open on this lane

| PR | Title | Note |
|---|---|---|
| [#2448](https://github.com/coreentryadmin-web/blackout-web/pull/2448) | unblock /api/og so OG + Article JSON-LD images are crawlable | — |
| [#2453](https://github.com/coreentryadmin-web/blackout-web/pull/2453) | kill homepage desktop CLS 0.55 — animate transform, not top | CLS 0.55 is far past the 0.1 "good" threshold and applies to the highest-traffic page on the site. Land it first. |
| [#2454](https://github.com/coreentryadmin-web/blackout-web/pull/2454) | add the 2026-08-21 organic search baseline | Docs-only — per `CLAUDE.md` this normally should not be its own PR. Fold it into a code PR or move it to `RUN-LOG.md`. |

## Lane-specific context

Ground truth is available: the GSC service account is in Secrets Manager at `blackout-production/seo/gsc-service-account`, verified `siteOwner` on **`sc-domain:blackouttrades.com`** — a DOMAIN property, so URL-encode it as `sc-domain%3Ablackouttrades.com`. Getting that wrong returns an EMPTY result rather than an error, which reads as "no search data" and is the same absence-as-fact trap rule 7 covers. A plain Google API key does NOT work for this API. Python's crypto stack is broken in this sandbox, so sign the JWT in Node.

GA4 is already live (`G-YLN4K37KYF`, `src/app/layout.tsx`) — do not "add" it. The real gap there is that GA4 events are not Google Ads conversions, and Ads has received none of them for months.

Bing needs nothing on the code side: IndexNow is wired and pings on every deploy via `deploy-smoke.yml`. Only the Webmaster Tools dashboard is missing, and that needs a human login.

**Do not build programmatic pages on live vendor values** — see `docs/marketing/RESEARCH-PUBLISH-POSTURE.md`. Public pages carry derived, delayed, aggregate, editorial content only, and the delay boundary is enforced by type in `src/lib/research/publishable-session.ts`.

## First moves

```bash
git fetch origin main
export PATH=/opt/nvm/versions/node/v20.20.2/bin:$PATH
node scripts/audit/agent-pr-sweep.mjs      # live state, never trust a remembered roster
```

Then read `docs/agents/FLEET.md` and `_COMMON.md`, and work your open PRs to green
one at a time, rebasing onto `main` after each merge.
