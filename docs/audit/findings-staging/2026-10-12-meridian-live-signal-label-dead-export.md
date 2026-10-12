## 2026-10-12 — [FINDING, P4 dead-code, docs-hygiene] `LIVE_SIGNAL_LABEL` (`meridian-viz-core.ts`) is fully dead — a prior fix's "has other live consumers" claim was factually wrong — FIXED

> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Meridian lib / viz primitives | P4 — dead code, no runtime impact; corrects a factual error in a prior fix's record | FIXED |

**What's wrong.** `src/lib/meridian/meridian-viz-core.ts`'s `LIVE_SIGNAL_LABEL` (a `Record<LiveSignal,
string>` label map) has had zero callers anywhere in the repo since the day it was introduced
(`f6438e046`/`ab30af1d8`). Its only-ever consumer was `MeridianSignalChip`
(`meridian-viz.tsx`), which PR #5780 ("fix(meridian): remove MeridianSignalChip dead component +
its dead CSS", 2026-10-10, commit `3021c556c`) deleted along with the `LIVE_SIGNAL_LABEL` **import**
from that file. That PR's own commit message explicitly left the `LIVE_SIGNAL_LABEL` **export**
itself in place, stating: *"`LiveSignal`/`LIVE_SIGNAL_GLYPH`/`LIVE_SIGNAL_LABEL` themselves... are
unchanged since they have other live consumers."* That claim is true for `LIVE_SIGNAL_GLYPH` (still
genuinely used elsewhere in `meridian-viz.tsx`, the intelligence-halo ring) but **false** for
`LIVE_SIGNAL_LABEL` — confirmed via `git log --all -S"LIVE_SIGNAL_LABEL"`: the only three commits
that ever touch the string are its introduction and the two fold/fix commits around PR #5780 itself.
`LIVE_SIGNAL_LABEL` never had any other consumer, in this file or anywhere else — the two names were
likely conflated in that PR's own write-up since `LIVE_SIGNAL_GLYPH` and `LIVE_SIGNAL_LABEL` are
adjacent, same-shaped `Record<LiveSignal, string>` maps defined back-to-back.

**Why this is a clean mechanical fix, not another deferral.** This repo's existing convention
(`docs/audit/FINDINGS.md`'s 2026-09-03 "Meridian — smaller, lower-signal items" entry) deliberately
defers deletion of dead-but-TESTED Meridian functions (`pctAlongCss`, `momentumSignal`,
`anomalySignal`, `hoursUntilIso` — re-checked this pass, all four remain genuinely dead but still
carry real, hand-written unit tests, so "built ahead of the caller that will wire it in" vs.
"abandoned" stays the owning lane's call, exactly as that entry already states, and none are touched
here). `LIVE_SIGNAL_LABEL` is different in kind: it is a bare data constant with no test of its own,
and the record shows WHY it's dead — a specific, named, already-identified prior fix removed its
only caller and simply mis-stated the export's own status in the same breath. This is a factual
correction to a record that already exists, not a fresh judgment call.

**Fix.** Deleted the `LIVE_SIGNAL_LABEL` export. `LIVE_SIGNAL_GLYPH` and the `LiveSignal` type stay
untouched — confirmed both still have real, live callers in `meridian-viz.tsx`.

**Verification.** `tsc --noEmit` clean. Full Meridian feature + lib suite (`npx tsx
--experimental-test-module-mocks --test $(find src/features/meridian src/lib/meridian -name
"*.test.ts" -o -name "*.test.tsx")`) — 526/526 pass.

**Blast radius.** One file, one five-line export removed. No test referenced it (confirmed via grep
of `meridian-viz-core.test.ts`), so no test change needed.

Found via a repo-wide dead-export heuristic sweep (every `export function`/`export const` across
Meridian/Vector/Thermal/Helix lib files, checked for zero cross-file references), independently
re-verified before fixing: confirmed the exact commit that orphaned it, confirmed the "other live
consumers" claim in that commit's own message is checkable and false specifically for this export,
and confirmed `LIVE_SIGNAL_GLYPH` (the export actually meant) is genuinely still live.
