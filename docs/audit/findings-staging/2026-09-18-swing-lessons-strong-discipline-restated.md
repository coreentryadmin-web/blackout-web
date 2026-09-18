> **kind:** `FINDING`

## Ask Largo swing brief's "Strong exit discipline" verdict was independently restated one section after "Trade manager read" already said it — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo play-brief (`src/lib/swing/play-brief-intel.ts`) — found via the Ask Largo standing mandate's continued swing deep-dive, the one branch today's earlier round-trip-restatement fixes didn't cover |
| **Severity** | P2 (the same disconnected-bullet-dump pattern the standing mandate flags, on arguably the MOST common closed-play outcome — any well-managed winner) |
| **PR** | fix/swing-lessons-strong-discipline-restated |

### Root cause

`lessonsSection` (`play-brief-intel.ts`) and `closedCoaching` (`play-brief-narrative-coaching.ts`)
independently derive the same MFE-capture verdict from the same `peak`/`exitPnlPct` inputs. Earlier
fixes today added `roundTripAlreadyNoted`/`adviceAlreadyNoted`/`stopAdviceAlreadyNoted` flags to
dedupe the `round_trip` kind and the capture<35 "gave back" branch — but the capture>=75 "Strong
exit discipline" branch had **zero suppression**, despite being the most common closed-play outcome
(any well-managed winner lands here).

Live repro (real production data via an authenticated Clerk session), CLOSED position CRWD #19
(target exit, 85.7% MFE capture): "Trade manager read" rendered *"**Strong discipline** — captured
85.7% of peak; replicate trim timing."* and the very next section, "Lessons," independently
restated *"MFE capture: 85.7% of peak move"* + *"**Strong exit discipline** — banked most of the
move; replicate trim ladder timing."* — same fact, same number, two adjacent sections.

### Evidence

- `play-brief-narrative-coaching.ts:1087`: confirmed `closedCoaching`'s capture>=75 branch pushes
  `"**Strong discipline** — captured **X%** of peak; replicate trim timing."` — grep-verified at
  the exact line.
- `play-brief-intel.ts` (pre-fix): confirmed `lessonsSection`'s capture>=75 branch pushed the
  restated verdict unconditionally, with no suppression flag parameter for this branch (unlike the
  round_trip/gave-back branches).
- No string-collision risk verified: `closedCoaching`'s exact phrase is "replicate trim timing"
  (no "ladder"), distinct from `lessonsSection`'s own "replicate trim ladder timing" — the
  `includes()` check used to derive the new flag cannot false-positive against the section's own
  text.

RED→GREEN proof (independently reproduced on a fresh `fix/swing-lessons-strong-discipline-restated`
branch off actual latest `origin/main`, post #5204's merge):
- Reverted `play-brief-intel.ts` via `git stash push -- <file>`, kept the new test (reproducing
  CRWD:19's exact numbers — peak 161.3%, exit 138.3%, capture 85.7%). `npx tsx
  --experimental-test-module-mocks --test src/lib/swing/play-brief-intel.test.ts`: **1 failure**
  (the new test) — 164/165 pass.
- Restored (`git stash pop`). Re-ran: **165/165 pass**.
- Broader sweep (all `play-brief*.test.ts` files): **641/641 pass**.
- `npx tsc --noEmit -p .` on Node 20: clean.

### Blast radius

Single-file fix: `lessonsSection`'s capture>=75 branch only. The raw "MFE capture: X% of peak move"
line (an independent, non-redundant fact) is untouched — only the restated verdict sentence is
suppressed, same discipline the file's existing "Peak was" test explicitly protects.

### Fix rationale

Minimal, targeted: added a 5th `captureAlreadyNoted` parameter to `lessonsSection`, mirroring the
existing `roundTripAlreadyNoted`/`adviceAlreadyNoted`/`stopAdviceAlreadyNoted` pattern exactly.
Gated the "Strong exit discipline" line push behind `if (!captureAlreadyNoted)`. At the call site,
derived via `narrative?.body?.includes("replicate trim timing")` — the same recipe every sibling
flag already uses, verified collision-free against `lessonsSection`'s own distinct phrasing.

### Verification

Independently re-verified from scratch on a fresh branch off actual latest `origin/main` (post
#5204's merge) — not the originating research agent's own working-tree state. The claimed
`closedCoaching` phrase and its exact line number, and the string-collision-safety claim, were both
independently grep-verified; RED/GREEN reproduced independently via `git stash`; broader
`play-brief*.test.ts` sweep (641/641) and `tsc --noEmit` both clean.
