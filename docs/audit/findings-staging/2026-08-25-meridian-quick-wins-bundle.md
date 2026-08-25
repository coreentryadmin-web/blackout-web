# Meridian quick wins bundle — 2026-08-25

> **kind:** `FINDING`

| **Status** | FIXED in `cursor/meridian-quick-wins-3d11` |
| **Audit** | `docs/audit/MERIDIAN-CERTIFICATION.md` open items + CTO audit friction list |

## Shipped in this PR

| Quick win | Status |
|-----------|--------|
| NVDA “no printed quarters” copy bug | **Already on `main`** (#2881 `printHistoryToAnalyticsRows`) — verified included |
| Lookup route full-response cache | **NEW** — `meridian:lookup:v1:{ticker}:{day}:{timelineKey}` wraps assembled payload (closes MERIDIAN-LOOKUP-CACHE) |
| Largo earnings tools → Meridian loaders | **NEW** — `get_earnings_history` / `get_earnings_market` read `print_history` + `meridian_reaction_pct` |
| Badge colors: yellow live, red assumed | **NEW** — `ReactionQualifier.kind` + `meridian-reaction-flag-live` / `-assumed` |
| Analytics grid + timeline lane sync | **NEW** — lite timeline `skip_enrich`, dual SWR, loading notice (no empty lane on view switch) |

## Evidence

- `meridian-reaction-display.test.ts` — kind on live/assumed
- `meridian-earnings-for-largo-core.test.ts` — Meridian reaction path
- `meridian-desk-prefs-core.test.ts` — prefs persistence
- `meridian-timeline-lite.test.ts` — fast lane
- `meridian-earnings-analytics-core.test.ts` — beat streak from print_history (main)

## Supersedes

Draft PRs #2887 (tier-1 friction) and #2889 (tier-2 prefs) are consolidated here; close those when this merges.
