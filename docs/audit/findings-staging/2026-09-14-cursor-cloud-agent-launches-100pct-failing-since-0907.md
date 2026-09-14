## 2026-09-14 — [FINDING, P1 CI/infra, REPORTED — NOT FIXED, needs secret/Cursor-account action] Every Cursor Cloud Agent launch across 7 GitHub Actions workflows has failed 100% of the time since 2026-09-07 20:06 UTC — silently, because every call site uses `curl -sf`

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | REPORTED — root cause needs either a `CURSOR_API_KEY` secret check/rotation or a Cursor-side account/API check, neither achievable from this sandbox (no GitHub secrets write access, no Cursor dashboard access). The diagnosability half (why every failure has been silent) is a real, fixable bug and is described below with a ready-to-apply patch, but is NOT applied in this PR — see "Why not fixed here" below for why this crossed from a "small self-contained fix" into a write-up. |
| **Severity** | P1 — this is not one failing check, it is the entire Cursor Cloud Agent autonomous-launch mechanism (RTH all-day Grid/SPX agents, the hourly checklist dispatch, the autopilot dispatch, the PR webhook auto-triage agent, the SEO weekly agent) having been completely non-functional for a full week with zero visible signal until this cycle's routine Actions-failure sweep caught it. |

### What's broken

Found via this cycle's routine `state=failure` Actions sweep: `RTH deep audit`, `Grid RTH all-day agent` (×2), `SPX RTH all-day agent` (×2) all failed within a 45-minute window today. The `RTH deep audit` failure is unrelated (a single transient `Postgres: read ECONNRESET` on one direct-TCP check — 38/38 other checks in that run passed; not investigated further here, looks like ordinary network flakiness). The Grid/SPX failures are the real finding.

Both fail identically, in well under a second, at the exact same step:

```
Run set -euo pipefail
...
##[error]Process completed with exit code 22.
```

Exit 22 is `curl`'s own code for "HTTP response indicated an error" when run with `-f` (`--fail`). Both workflows call:

```bash
resp=$(curl -sf -X POST https://api.cursor.com/v1/agents \
  -u "${CURSOR_API_KEY}:" \
  -H 'Content-Type: application/json' \
  -d "$payload")
```

`-sf` together means: suppress all output AND exit non-zero on any non-2xx HTTP status, printing **nothing** — no status code, no response body, no error message of any kind. So every failure of this call has been, and will keep being, completely opaque in the Actions log.

### How bad, and since when — checked, not assumed

Pulled the full recent run history for `Grid RTH all-day agent` (workflow id 307677541) via the REST API rather than trusting the failure list alone:

- Every run in the last 100 (covering 2026-09-04 through today) that is NOT a weekend/off-schedule gap has `conclusion: failure`, with exactly one exception.
- **The most recent `success` was `2026-09-07T20:06:05Z`.** Every scheduled run since — 2026-09-08 through today, 2026-09-14, on every trading day (2026-09-12/13 have no scheduled fires, correctly, per the workflow's Mon-Fri cron) — has failed. That is **a full week, 100% failure rate**, not an intermittent flake.
- Confirmed `CURSOR_API_KEY` is not simply unset: both workflows explicitly check `if [ -z "${CURSOR_API_KEY:-}" ]; then echo "...skipping."; exit 0; fi` before the curl call, and neither run hit that early-exit — they proceeded to the curl call and got exit 22 there. So the secret has SOME value; it is being rejected by the Cursor API itself (invalid, expired/rotated, or an account/quota issue), or the API is otherwise erroring — none of which is visible from the log as it stands.
- Ruled out a code regression as the cause: `git log` on `grid-rth-all-day-agent.yml`, `spx-rth-all-day-agent.yml`, `rth-cloud-agent.yml`, and `scripts/blackout-agent/dispatch-prompt.mjs` (the shared prompt-bootstrap script every one of these workflows calls) shows **zero commits** touching any of them between 2026-09-06 and 2026-09-09 — the window bracketing the last success. This did not break because of a change to this repo's own code.

### Blast radius — same `curl -sf` pattern in 7 workflows total

```
$ grep -rl "curl -sf.*api.cursor.com" .github/workflows/
.github/workflows/blackout-autopilot-dispatch.yml
.github/workflows/rth-cloud-agent.yml
.github/workflows/blackout-hourly-checklist.yml
.github/workflows/seo-weekly.yml
.github/workflows/blackout-pr-webhook.yml
.github/workflows/spx-rth-all-day-agent.yml
.github/workflows/grid-rth-all-day-agent.yml
```

All 7 POST to the same `https://api.cursor.com/v1/agents` endpoint with the same `CURSOR_API_KEY`, so if the key/account is the actual cause (the leading hypothesis given no code changed), **all 7 are almost certainly broken the same way**, not just the two whose CI shows a visible red X. Four of them (`blackout-autopilot-dispatch.yml`, `blackout-hourly-checklist.yml`, `blackout-pr-webhook.yml`) already soft-fail the curl call (`|| { echo "::warning::..."; exit 0; }` or `if ! resp=$(...); then ...; exit 0; fi`), so **their failure produces only a yellow `::warning::` annotation, not a red CI failure** — which is exactly why this went unnoticed for a week: only the 2 hard-failing workflows (Grid/SPX RTH all-day agents, which have no such guard) ever surfaced as a failing check at all, and even those give zero diagnostic content once you open them. `seo-weekly.yml`'s call has no explicit error handling shown at that line either.

This is very likely also the reason the standing Ask-Largo/Night-Hawk-Swings mandate's own text (`ASK LARGO × NIGHT HAWK SWINGS` section, `CLAUDE.md`) has been narrating a very Claude-heavy week with comparatively little visible Cursor PR activity on #4076 beyond its own comments — if the Cloud Agent launch mechanism has been down since 09-07, Cursor's autonomous side of several of these dispatch loops may simply not have been running.

### Why this is a write-up, not a same-PR fix (per the standing brief's own guidance)

The diagnosability fix itself is small and mechanical — for each of the 7 call sites, replace the bare `-sf` with capturing HTTP status and body separately (e.g. `-s -w $'\nHTTP_STATUS:%{http_code}'`, no `-f`) and print the status + a truncated body whenever the status is not 2xx, before taking the same pass/fail branch the file already takes. But:

1. **The actual root cause is not fixable from here.** No GitHub Actions secrets write access, no Cursor account/dashboard access. Shipping only the diagnostic-visibility half fixes visibility, not the outage — the mechanism stays down either way until someone with the right access checks/rotates `CURSOR_API_KEY` or checks the Cursor account/API status.
2. **7 files, 4 different surrounding shapes** (bare hard-fail, `|| { ...; exit 0; }` soft-fail, `if ! ...; then ...; exit 0; fi` soft-fail, a bare pipe into `head -c 400`) spanning the repo's entire Claude/Cursor autonomous-dispatch surface — including the mechanisms this very collaboration protocol relies on (`blackout-autopilot-dispatch.yml`, `blackout-hourly-checklist.yml`, `blackout-pr-webhook.yml`). None of these can be live-tested from this sandbox without actually invoking a real (currently-broken) Cursor agent launch. A subtly wrong edit to any of them degrades a currently-important cross-agent mechanism with no way to verify the fix before it ships. That combination — broad blast radius across live automation infra, unverifiable without a real invocation — is exactly the "bigger, write it up" case the standing brief calls out, not the "small self-contained bug, fix directly" case.

### Proposed fix (for whoever has the access to also address the root cause)

Once the underlying `CURSOR_API_KEY`/account issue is resolved, apply this shape to all 7 call sites (shown for the plain hard-fail form; the soft-fail forms keep their existing `exit 0` branch, just reached via an explicit status check instead of curl's own `-f`):

```bash
resp=$(curl -s -w $'\n%{http_code}' -X POST https://api.cursor.com/v1/agents \
  -u "${CURSOR_API_KEY}:" \
  -H 'Content-Type: application/json' \
  -d "$payload")
status="${resp##*$'\n'}"
body="${resp%$'\n'*}"
if [ "$status" -lt 200 ] || [ "$status" -ge 300 ]; then
  echo "::error::Cursor agent launch failed (HTTP $status): $(echo "$body" | head -c 500)"
  exit 1
fi
resp="$body"
```

### Suggested next step

1. Whoever owns `CURSOR_API_KEY` (GitHub repo secret) or the Cursor account it authenticates to should check the key's validity/expiry and the account's API status directly — that is the actual blocker, and it is a credential/account check, not a code fix.
2. Once access is confirmed and a launch succeeds again, apply the diagnostic-visibility patch above to all 7 files in one PR so a future outage of this shape is visible in the Actions log on the FIRST failure, not silently for a week.
3. Raised on the standing #4076 Claude↔Cursor collaboration thread for awareness, since several of the broken workflows are literally the mechanism by which Cursor's own Cloud Agents get launched from this repo.
