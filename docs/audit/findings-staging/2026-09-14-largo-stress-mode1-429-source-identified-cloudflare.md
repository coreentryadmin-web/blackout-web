## 2026-09-14 — [FINDING, P2 Largo/CI, Mode 1 diagnostic confirmed working — 429 source now identified as Cloudflare edge, not an upstream API] Second largo-stress-nightly run today (real `schedule` event) shows Mode 1's header capture firing for the first time, and it points at Cloudflare, not Largo/Anthropic/Clerk

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | REPORTED — Mode 1's diagnostic code path is now confirmed working (this is the first run to actually hit a real http-429 since the fix shipped), and it answers the open "which upstream?" question from the original Mode-1 background with a concrete, if incomplete, answer: Cloudflare. No fix applied — this narrows the investigation, it doesn't resolve it. |
| **Severity** | P2 — same class as the rest of this finding chain. Coverage loss this run (35%, 38/109) is worse than any previously-recorded run, including the ones that predated the Mode 1/2 fixes — the 429 storm itself is not improving. |

### What changed since the last entry in this chain

Two `largo-stress-nightly` runs completed today: the manually-triggered one at 07:17 UTC (PR #4962/#4964 — `live_bad:0`, but hit a *different* transport failure, HTTP-401 session-reauth-throttle, not a 429) and a second, genuinely scheduled run (`event: schedule`) at **13:11:32 UTC — 6h41m after its nominal 06:30 UTC slot**, run `34847708062`, conclusion `success`.

```
bank_spec: "1", total: 109, live_ok: 61, live_bad: 0, live_warn: 10,
live_skipped_transport: 38, live_quality_pct: 85.9
```

**Mode 2 holds again** (`live_bad: 0`, 2 for 2 runs today).

**Mode 1's header-capture code path fired for the first time** — this run hit real `http-429`s (≈31 of the 38 skips), each logged with a `[429 source details]` block as PR #4926 intended. But every single one of those blocks contains **only `cf-ray`** — no `x-ratelimit-limit`/`x-ratelimit-remaining`/`x-ratelimit-reset` ever appear. Example:

```
– 2141ms SKIP | vector setup on NVDA 0DTE
    http-429 — transport, excluded from the quality tally
    [429 source details] {"cf-ray":"a3afc4b399464dea-MCI"}
```

`cf-ray` is a Cloudflare-specific response header — it does not originate from Anthropic's API, Largo's own backend, or Clerk's FAPI. **This is a real, if partial, answer to the original Mode-1 question ("source unknown... could be Largo API, Anthropic API, Clerk FAPI, Next.js, or Cloudflare")**: the 429s are being generated at the Cloudflare edge, not by any of the application-layer services. The remaining ~7 skips this run were the same HTTP-401 session-reauth-throttle pattern seen on the earlier run today (`sign_in_tokens mint failed (HTTP 404 resource_not_found)` → `re-establish throttled`).

### Why this matters beyond "now we know"

- It rules out the app-layer rate-limit hypotheses the original Mode-1 background named (Anthropic API quota, Largo's own throttle, Clerk FAPI limits) — none of those would produce a bare `cf-ray`-only 429.
- It points investigation at Cloudflare's own rate-limiting rules for `blackouttrades.com` (the same zone CLAUDE.md's "Access reality" section already documents cache-ruleset write access for) — a WAF rate-limiting rule, a bot-management heuristic, or an edge concurrency/rps limit are the natural next things to check, not application code.
- **Coverage loss got WORSE, not better**: 35% (38/109) this run vs. the previously-recorded 33%/35.5% pre-fix runs and the 8.3% (401-only) manually-triggered run this morning. Mode 1 was never meant to reduce the 429 rate — it's diagnostic-only — so this isn't a regression in the fix; it's confirmation the underlying storm is undiminished.

### Also re-confirmed: the schedule-drift issue is real and getting worse, not self-correcting

This run fired 6h41m late (13:11 vs. nominal 06:30). Combined with yesterday's outright no-fire (necessitating the manual trigger), this is now two consecutive days where the scheduled slot has been unreliable well beyond the "~55min normal jitter" baseline `2026-08-31-largo-stress-nightly-schedule-drift.md` established. Not re-diagnosing the mechanism here (already documented as fleet-commit-velocity-correlated GitHub Actions `schedule:` drift) — just noting it's still live and worth someone eventually deciding whether this workload should move off `schedule:` entirely, per that earlier finding's own suggested next step.

### Not fixed here

Same disposition as the rest of this chain: whoever owns Cloudflare zone configuration for `blackouttrades.com` needs to check the dashboard/API for an active rate-limiting rule matching the Largo `/api/market/largo/query` (or broader) path and either raise its threshold for this specific CI workload, exempt the stress-test's originating IP/user-agent, or accept the coverage loss as a known cost. This is a Cloudflare configuration decision, not something to guess at or change unilaterally from this sandbox — the CF API token available here has cache-ruleset write access but rate-limiting rules are a different, higher-blast-radius surface.

### Suggested next step

1. Check the Cloudflare dashboard/API for `blackouttrades.com`'s rate-limiting rules (`GET .../zones/{zone_id}/rulesets` filtered to a rate-limiting phase, distinct from the `http_request_cache_settings` phase this repo's tooling already reads) and see whether one is matching the stress-test's traffic pattern (rapid sequential POSTs to the same Largo endpoint from one IP/session).
2. If a rule is found and is the cause, decide whether to raise its threshold, add an exemption, or accept the loss — a real judgment call given rate-limiting exists for a reason (protecting the same endpoint from actual abuse).
3. Re-run and check whether `[429 source details]` ever carries more than `cf-ray` — if some 429s DO show `x-ratelimit-*` headers on a future run, that would mean there are two distinct 429 sources (Cloudflare AND an app-layer one), not one.
