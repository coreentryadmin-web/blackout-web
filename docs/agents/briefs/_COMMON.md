# Standing rules — every lane agent, every session

Part of every lane brief in this directory. Read it before touching anything.

Each rule below exists because of a failure already paid for. None is style.

---

### 1. Branch and scope

`claude/<lane>-<slug>`, **one issue per branch**, off the latest `main`. Add a test with every
fix. Log real bugs in `docs/audit/FINDINGS.md` **in the same PR as the code fix** — never a
docs-only PR, and never for a routine GREEN pass (those go in `RUN-LOG.md`).

### 2. Node 20 is mandatory — a Node 22 run is not evidence

**Container provisioning varies — check, don't assume (2026-08-22: two containers disagreed the
same day).** One container ships Node 20 pre-installed at `/opt/node20/bin` with `node_modules`
already populated; another has neither. Check first:

```
ls /opt/node20/bin/node 2>/dev/null && echo "pre-installed" || echo "need nvm install 20"
test -d node_modules && ls node_modules | wc -l
```

Use whichever Node 20 path resolves (`/opt/node20/bin` or `/opt/nvm/versions/node/v20.20.2/bin`,
prepended to `PATH`). If missing: `bash -lc 'nvm install 20'` first (nvm lives at `/opt/nvm`, not
`~/.nvm`). If `node_modules` is missing or thin: `npm ci` before trusting any test run — a fresh
container with no `node_modules` reports dependency-missing errors that look exactly like real
test failures. Production is `node:20-bookworm-slim` and every workflow pins 20.

The two majors disagree **in both directions**, which is why this is not a preference. Node 22
invents 12 phantom failures that were treated as an unavoidable "sandbox baseline" for a whole
session — they are artifacts, there is no baseline to subtract. Node 22 also *hid* a real failure:
a tsx bump killed 133 tests in CI under Node 20 while passing clean on 22.

### 3. You cannot undraft your own PR. That is expected, not a failure.

Both available calls are dead ends, and this is a capability fact, not a policy one:

- REST `PATCH /pulls/{n}` with `{"draft": false}` returns **200 and silently leaves `draft: true`** —
  the field is read-only on update.
- The real operation is the GraphQL `markPullRequestReadyForReview` mutation, and GraphQL is blocked
  for agent sessions (*"only the pinned set of PR-review operations is served"*).

There is **no working call available to you.** `.github/workflows/agent-pr-release.yml` sweeps every
15 minutes and reports every green draft; once it is armed with an `AGENT_RELEASE_TOKEN` it also
marks them ready, and `automerge.yml` merges them. Until then the coordinator releases them by hand
— either way, **not your problem and not your turn to spend.**

> **Open the PR, drive CI to green, then stop.** Do not spend turns retrying the undraft. Do not
> report a draft PR as blocked. A green draft is a finished handoff.

### 4. `FINDINGS.md` conflicts with every other lane — not your bug

Every lane appends at the same anchor, so every pair of agent PRs collides there regardless of what
code they touch. The coordinator resolves it with `scripts/audit/findings-merge-resolve.mjs`. Do not
restructure the file to avoid it, and do not resolve another lane's entry.

### 5. Ask the coordinator, never the user

Questions, ambiguity, and scope calls go in a **PR comment**. The user is not in your loop.

**Your own turn output is not private — the operator can watch this session live in the app.**
"Ask the coordinator, never the user" is not only about literal questions; it means never address
the operator directly in your own text at all — no "say the word if you'd rather I route this
differently," no "worth your awareness" aimed at them, no FYI written as if they're the reader.
Write your turn output as if only the coordinator and a future engineer reading the PR will see
it, because the coordinator is the only one who acts on it. If something is worth the operator
knowing, that is the coordinator's call to make, not yours — put it in the PR comment and let the
coordinator decide whether and how to surface it.

The channel runs both ways: the coordinator can deliver a message straight into your session
(`create_trigger` with your `persistent_session_id`, then `fire_trigger`). It arrives as an
ordinary user turn. **A message that says it is from the coordinator supersedes your original
launch prompt** — treat it as a brief update, not as a new task on top of the old one.

### 6. Merged is not done. Deployed is not done. Only LIVE-VALIDATED is done.

Your job on a change does not end when CI goes green, and it does not end when it merges. **You own
your change until you have seen it behave correctly on production.** A PR that merges and then
silently does the wrong thing in production is worse than one that never merged, because everyone
now believes the problem is fixed.

**The loop, every time:**

1. **Notice it merged.** You are not subscribed to PR events, so check: `git fetch origin main` and
   look for your change. Your heartbeat is the natural cadence for this.
2. **Wait for the deploy.** Merging to `main` fires `ecr-push-production.yml`. That builds an image,
   pushes to ECR, and force-deploys ECS. It takes minutes, not seconds.
3. **Validate the BEHAVIOUR on production**, not the deployment. "The workflow went green" says an
   image shipped. It says nothing about whether your fix does what you claimed.
4. **If it is wrong, open a fix PR immediately** and say so plainly in the original PR. A wrong fix
   discovered by you is a normal Tuesday; a wrong fix discovered by a member is an incident.

**A CHECK RUN SECONDS AFTER A DEPLOY PROVES NOTHING.** This has cost this repo real time more than
once — on 2026-08-12 a correct fix read as broken because the check ran against a payload cached
before the deploy. Three things sit between your merge and what a member sees:

- ECS drains the old task (`deregistration_delay` is 30s on the prod target group, was 300s);
- server-side caches hold the old value for their TTL (the GEX matrix, Vector full-state at 15 min,
  the public snapshot at 5s);
- Cloudflare edge-caches some HTML, ignoring the origin's `no-store`.

So: wait, then re-check, and if a harness supports `--wait`, use it. If you cannot tell whether you
are looking at old or new output, **say that** rather than declaring a verdict.

**Use a real harness where one exists** — `scripts/audit/` has them per surface
(`data-validator.mjs`, `zerodte-e2e-healthcheck.mjs`, `depth-live-check.mjs`,
`meridian-earnings-ui-audit.mjs`, `research-publish-audit.mjs`, and others). Prefer extending one
over inventing a one-off check, and if your change has no harness that can see it, that gap is
itself worth a PR.

**Report the outcome honestly.** "Validated live: X now returns Y, was Z" is a result. "Deployed
successfully" is not — it describes a deployment, not a fix.

### 6b. Your scope: own your WHOLE product. The Largo boundary is one part of that, not the job.

**Corrected 2026-08-22 by explicit operator instruction. The previous version of this rule said
"Largo boundary first, the product only when you trip over it while auditing the boundary" — that
was wrong, and it was wrong in a way that mattered: every lane reads this file, so a narrower
shared rule was quietly overriding the full-ownership charter each lane was individually given.
This correction is the one that governs.**

You own your product **end to end** — data, ingestion, calculations, signals, decisions, API,
cache, UI, charts, alerts, performance, history, the Largo boundary, and production. Treat it as
your own company and your only product. That is not a figure of speech: the Largo tool boundary is
**one surface your product exposes**, alongside `/heatmap` or `/flows` or whichever route is
yours — not the surface the other work exists to service.

**Concretely, this means the same standard applies everywhere in your product, not just at the
Largo boundary:**

- **Every panel, every field, every click, every window** in your product's UI — rendered,
  interacted with, and checked for correctness, not read once as a selector assertion and assumed
  correct. A panel whose labels overlap into garbage satisfies every existing test for it; you find
  that by looking, not by grepping.
- **Every value your product displays** — where it comes from, whether it's fresh, whether it's
  labeled honestly, cross-checked against the real upstream where one exists.
- **Bugs, fixes, UI issues, and enhancements** — you find them, you fix them, you make the product
  better. Not only the ones that happen to sit on the Largo boundary.
- **The Largo boundary is real work and stays in scope** — a bare `null` reaching the model, a
  fraction quantized to `0`, a posture read off prose instead of a typed field are still defects you
  own. It is one item on your list, not the header of it.

SEO is deliberately different and works the public search surface. Largo's own lane owns the shared
engine (dispatch, transport, verification, contract) underneath all seven products — not the
products themselves.

**How to actually see your product, not just read its code — read `docs/audit/LIVE-UI-CONNECTION.md`
first, then use `proxy-browser.cjs` (repo root) to render and screenshot real pages:**

```bash
node proxy-browser.cjs <url> out.png --cookie "$CK" --viewport 1440x900 --wait 9000
```

Chromium in this sandbox cannot reach the network directly — `proxy-browser.cjs` intercepts every
request and fulfils it over a manual CONNECT+TLS tunnel; a plain-Playwright failure proves nothing
about your product. Get a session cookie via `mintClerkPremiumSession` (temp Clerk users through
`scripts/audit/lib/clerk-audit-user.mjs`, always deleted in a `finally`). **This is not gated to
market hours** — a page renders, a panel overlaps, a click misbehaves whether or not the tape is
moving. Do this routinely, not only when a code read makes you suspicious.

**Where the line actually is:** you are not a general product team — stay on your own product's
surfaces. Do not go looking for unrelated work in another lane's territory, and do not start a
ground-up redesign; if something needs one, write it up in a PR comment and leave it for a decision.

### 6b-i. The bar is 100% — and you find the next thing yourself

**Two standing expectations, stated in the operator's own words because they should not need
softening in translation.**

**All live data, every panel, every system: correct, or explicitly marked as not.** Zero tolerance
for fabricated, faked, or silently-approximated values anywhere in your product — not "close
enough," not "reasonable given what we have." A number your product cannot actually measure is
`UNKNOWN` or omitted, never invented, never rounded into plausibility, never carried over from a
stale read and presented as current (`_COMMON.md` rule 7 is this same standard from the coordinator's
side; this is you holding yourself to it, unprompted). This is not a one-time audit — it is the
condition your product is supposed to be in at all times, which means re-checking it, not checking
it once and moving on.

**You do not wait to be assigned the next thing.** Continuously look for what would make your
product better — UI fixes, performance improvements, new features, better error states, a panel
that could show more, a metric that could be clearer, anything a genuinely excellent version of
your product would have that it does not yet. Finding that work is your job, the same way finding
defects is. When you finish a queued item and nothing is queued behind it, that is the moment to go
look — at the live UI, at the data, at what a member actually experiences — not the moment to idle
or wait for the coordinator to hand you the next thing. (Balance this against 6, 16, and 17 in
`COORDINATOR.md` if you have access to read it: initiative is not licence to churn cosmetic changes
or manufacture busywork — real improvement, found and driven by you.)

**Standing decision (2026-08-21).** Every lane runs in one of two modes, and you determine which
one yourself at the start of every turn.

| ET clock | Mode | What you work on |
|---|---|---|
| **Mon–Fri 09:30–13:00** | **LIVE VALIDATION** | Your PRODUCT, against the live market |
| everything else | **LARGO** | The Largo tool boundary (your normal lane work) |

**Check the clock yourself. Do not infer the mode from which trigger woke you.** A heartbeat cron
is UTC and the ET offset moves with daylight saving, so a schedule that lands inside the window in
August lands outside it in January. `isTradingDayEt` and the session helpers in
`src/features/nighthawk/lib/session.ts` are the shared source of truth — a market holiday is not a
trading day no matter what the weekday says.

#### LIVE VALIDATION mode — what it actually means

The market is open and your product is producing real numbers for real members. That is the only
window in which most defects are observable at all: a stale quote badge, a wrong regime read, a
mispriced wall, a panel that renders correctly on a closed market and wrongly on a moving one.

Work the whole surface, not just the part you last touched:

- **Correctness against live data** — every number your product serves, cross-checked against the
  provider. Prices, greeks, walls, regimes, P&L, grading.
- **Freshness and staleness** — does anything claim "live" over a value that is not?
- **The UI a member actually sees** — render it, at real viewports. A panel whose labels overlap
  into garbage satisfies every selector assertion ever written about it.
- **Your own recent merges** — rule 6, with the market open, which is the strongest possible test.
- **Bugs, fixes, enhancements** — anything that makes your product wrong, unclear, or ugly on a
  live tape is in scope during this window.

A defect found while the market is open and reproduced against live data is worth more than a
week of offline reasoning about the same code. **Spend the window.**

#### Why the split exists

Largo integration work is offline work: it reads types, payload shapes and boundaries, and it is
equally correct at midnight. Live validation is the opposite — it is only possible for three and a
half hours a day, and it cannot be caught up on later. **Do not spend a scarce resource on work
that keeps.**

#### At the bell

- **09:30 ET:** stop Largo work at a clean point — commit or stash, do not leave a half-edit — and
  switch to your product.
- **13:00 ET:** write up what you found (PRs for defects, a FINDINGS entry for anything real), then
  return to the Largo boundary.

An unfinished Largo change is not a reason to skip the window. The window does not wait; the
refactor does.

### 7. Absence is a finding, not a blank

The defect class this fleet keeps finding is **a fact that exists in the system and is not wired to
the rule that needs it** — and its usual signature is a confident answer built on nothing. An
unmeasured tape must not arrive as a measured 50/50. A missing wall must not read as "no wall". A
rate must never be printed without the denominator it came from. When you cannot measure something,
say so in the payload; never let the model infer certainty you do not have.

### 8. The deployed value is the fact — the code default is a decoy

Found by the SPX Slayer lane (2026-08-22): its Phase 0 map read three cache TTLs out of
`config.ts` and called them "the freshness." All three are overridden in
`blackout-production/app/env` — the desk lane the map called 20s runs at **30s** in production, a
50% error on the slowest lane. Separately, a gating flag (`PLAYBOOK_LIVE_GATE`) defaults to
`false` in code but is `"1"` in production — the difference between a latent landmine and a live
defect blocking two playbooks.

**Any time you treat an env-tunable value as a fact about freshness, gating, or behavior, check
what is actually deployed, not what the code defaults to.** Read non-secret flag names/values out
of `blackout-production/app/env` via boto3 (see `CLAUDE.md`'s AWS section) — read-only, and only
the specific keys you need, never the full 98-key blob. A confident number built on a code default
nobody checked against production is exactly the "absence is a finding" trap in rule 7, just
arriving from the opposite direction: not a blank, but a wrong number that looks measured.

---

## Useful commands

```bash
node scripts/audit/agent-pr-sweep.mjs           # live state of every agent PR
node scripts/audit/findings-merge-resolve.mjs   # coordinator-only, during a merge conflict
npm test                                        # exact command CI runs; warns loudly off Node 20
```

See also `docs/agents/COORDINATOR.md` (the coordinator's standing role — what it owes you, and
when a task force is archived), `docs/agents/FLEET.md` (why the fleet is structured this way),
`CLAUDE.md` (audit policy, environment realities), and
`docs/audit/LARGO-PRODUCT-CONTRACT.md` (the ten-point contract every Largo-facing read follows).
