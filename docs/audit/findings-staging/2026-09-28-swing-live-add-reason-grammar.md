## 2026-09-28 — [FINDING, P3 Ask Largo / Night Hawk Swings] Swing `reason` string read "live add to — SECTOR_ROTATION thesis" for any position with an ADD manage signal

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Symptom** | Live-confirmed 2026-09-28 on a real AAPL committed swing position with `manageAction: "ADD"` — the play-brief's Verdict/Management sections (and the underlying `reason` field on `GET /api/market/nighthawk/horizons?view=swings`) read `"live add to — SECTOR_ROTATION thesis"`, a dangling preposition with no object. |
| **Root cause** | `REASON_VERB_BY_MANAGE_ACTION` in `src/lib/swing/live-plays.ts` mapped `ADD` to the verb `"add to"`, but the template that consumes it is `live ${verb} — ${archetype} thesis` — every other verb (`exit`, `stop out`, `trim`) reads grammatically complete standalone in that shape ("live exit — ... thesis"); `"add to"` was written as if a following noun phrase would complete the sentence, and none does. |
| **Blast radius** | Every swing position whose live manage signal is `ADD` (advisory add-eligible) — surfaces directly in the member-facing Verdict/Management sections of the swing play-brief, and in the raw `reason` field on the swings horizons board route. Cosmetic (no data-correctness impact), but a broken sentence in front of a trade-manager voice sits right at the "narrative quality" seam this standing mandate exists to catch. |
| **Fix** | Changed `ADD: "add to"` → `ADD: "add"` in `REASON_VERB_BY_MANAGE_ACTION` (`src/lib/swing/live-plays.ts`) — now reads `"live add — SECTOR_ROTATION thesis"`, matching the shape of every other verb in the map. |
| **Evidence** | Live repro above (raw JSON `reason` field confirmed via direct authenticated fetch). New regression test `livePlayFromSwingPosition: ADD manageAction produces a grammatically complete reason string (live AAPL repro, 2026-09-28)` (`live-plays.test.ts`) — verified RED pre-fix (`git stash` proof) / GREEN post-fix. Full file suite: 49/49 pass. `npx tsc --noEmit` clean. |
| **Status** | FIXED — PR opened, awaiting CI. |
