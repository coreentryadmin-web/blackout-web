> **kind:** `FINDING`

## Ask Largo swing brief's Book-context narrative leaked an internal theme-cluster sentinel (`NAME:BYND`) straight into member-facing text — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo play-brief — `theme-cluster.ts`, call sites in `play-brief-intel.ts` and `play-brief.ts` — found via the Ask Largo standing mandate's continued swing deep-dive |
| **Severity** | P2 (a real, live, member-facing provenance/narrative-quality defect — an internal implementation key leaking into trader-facing text, not a hypothetical) |
| **PR** | fix/swing-theme-sentinel-leak |

### Root cause

`theme-cluster.ts`'s `resolveTheme()` returns an internal sentinel `NAME:<TICKER>` (the
`OWN_CLUSTER_PREFIX` constant) when a ticker maps to no shared sector/theme — meant purely as an
internal partition key so an unmapped name is never falsely merged into a shared thesis cluster.
Three call sites (`play-brief-intel.ts`, two locations, and `play-brief.ts`) hand-built
`theme "${overlap.theme}"` and interpolated that raw sentinel directly into narrative/evidence
text intended for a member to read.

Live repro (real production data via an authenticated Clerk session), BYND (2 concurrent positions
on the same ticker, unmapped in `sector-map.ts`): both `envelope.evidence` and the "Book context"
section literally rendered:

> Book overlap: 1 same-direction position in theme "NAME:BYND".

### Evidence

- `theme-cluster.ts:31`: `const OWN_CLUSTER_PREFIX = "NAME:";` confirmed.
- `theme-cluster.ts:99`: `resolveTheme` returns `` `${OWN_CLUSTER_PREFIX}${up}` `` for an unmapped
  ticker — grep-verified at the exact line.
- Pre-fix call sites (confirmed via `git diff` against the fix): `play-brief-intel.ts` (two
  locations) and `play-brief.ts` each hand-built `` `theme "${overlap.theme}"` `` with no awareness
  of the sentinel prefix.

RED→GREEN proof (independently reproduced on a fresh `fix/swing-theme-sentinel-leak` branch off
actual latest `origin/main`, post #5204/#5205/#5208's merges):
- Reverted `theme-cluster.ts`, `play-brief-intel.ts`, `play-brief.ts` via `git stash push -- <files>`,
  kept the new tests (which assert the exact live string `theme "NAME:BYND"` never renders). `npx
  tsx --experimental-test-module-mocks --test theme-cluster.test.ts play-brief-intel.test.ts
  play-brief.test.ts`: **2 failures** (the new tests) — 258/260 pass.
- Restored (`git stash pop`). Re-ran: **260/260 pass**.
- Broader sweep (all top-level `src/lib/swing/*.test.ts` files): **1336/1336 pass**.
- `npx tsc --noEmit -p .` on Node 20: clean.

### Blast radius

Three call sites, all in the swing play-brief narrative layer (`play-brief-intel.ts` ×2,
`play-brief.ts` ×1) — every place that quotes `resolveTheme`'s output directly in member-facing
copy. `theme-cluster.ts` itself gained three new exported helpers
(`themeDisplayLabel`/`isOwnClusterTheme`/`describeThemeOverlap`); `resolveTheme`'s own internal
sentinel format and every non-narrative consumer (`sameThesis`, the book-overlap detection logic
itself) are unchanged — only the three narrative-facing interpolation sites were touched.

### Fix rationale

Minimal, targeted: added a display-label helper layer rather than changing `resolveTheme`'s
internal sentinel format (which other logic depends on as a stable partition key, per the file's
own doc comments on why `NAME:` prefixing exists). `describeThemeOverlap(theme)` renders "the same
name (BYND)" for an own-cluster sentinel and the unchanged `theme "software"` phrasing for a real
shared theme, so a real theme's copy is byte-identical to before — only the leaking case changes.

### Verification

Independently re-verified from scratch on a fresh branch off actual latest `origin/main` (post
#5204/#5205/#5208's merges) — not the originating research agent's own working-tree state. The
claimed sentinel format and prefix constant were independently grep-verified at their exact
locations; the pre-fix call-site shape was confirmed via `git diff`; RED/GREEN reproduced
independently via `git stash`; broader `src/lib/swing/*.test.ts` sweep (1336/1336) and `tsc
--noEmit` both clean.
