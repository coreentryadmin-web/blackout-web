## Night Hawk `/nighthawk` degraded-board banner reproduced live, once, then self-corrected on next render — real UI-level corroboration of the already-tracked cold-rebuild mechanism — investigation-status update, no source change

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | Investigation-status update only — no code fix, no source change. Corroborates the already-open ALB tail-latency / `getZeroDteBoardPayload()` cold-rebuild investigation (this file's 2026-10-11 "ALB tail-latency investigation — new angle measured" entry) with a live, screenshotted member-facing repro of the exact mechanism that entry could previously only infer from CloudWatch. |
| **Severity** | P3 (transient, self-correcting, off-hours only — tracked under the existing P1's umbrella, not a new standalone defect) |
| **Component** | `src/features/nighthawk/command-deck/CommandDeck.tsx` (renders the `degraded` banner), `src/features/nighthawk/lib/deck-empty-hint.ts` (the off-hours-vs-degraded copy logic), `getZeroDteBoardPayload()` (`src/lib/providers/zerodte-service.ts`) via `GET /api/market/zerodte/board`. No `src/` change. |

### What was observed

Live `proxy-browser.cjs` screenshots of `https://blackouttrades.com/nighthawk` (authenticated,
temp premium Clerk session, mobile UA, 2026-10-11, a Sunday — non-trading day) taken across this
DISCOVERY cycle:

1. **First screenshot**: rendered the degraded-state banner — `⚠ Board data unavailable —
   retrying` (`CommandDeck.tsx`'s `degraded` branch) — with Open/Watch/Closed all at 0.
2. **A direct, authenticated `GET /api/market/zerodte/board` check moments later**: `upstream_ok:
   true`, fresh `as_of`, `session.trading_day: false`, `session.heat.state: "CLOSED"`,
   `session.heat.note: "No session today — Night Hawk's evening playbook covers the next open."` —
   a completely healthy, correct off-hours payload, not an outage.
3. **Second screenshot, shortly after**: no degraded banner — the correct, calm "No session
   today — Night Hawk's evening playbook covers the next open." message.
4. **Third screenshot, re-run independently ~20+ minutes later** (fresh temp Clerk session, fresh
   API check first confirming the same healthy off-hours payload): also no degraded banner, same
   correct message, confirming the healthy state is the steady state, not a fluke of timing between
   screenshots 2 and 3.

So across 3 independent live screenshots this cycle, the degraded banner appeared exactly once, on
the very first render, and never again on identical subsequent requests against an API that was
healthy the entire time.

### Why this isn't a bug in `deck-empty-hint.ts`/`CommandDeck.tsx`'s own logic

Read `deck-empty-hint.ts` in full: it already has a deliberate, documented (2026-08-23 header
comment) distinction between `degraded` (real backend outage) and `NOT_SCANNING_STATES`
(`CLOSED`/`PRE_MARKET`, an honest off-hours absence) and prefers the server's own
`session.heat.note` copy over a hardcoded fallback. Given the payload observed in step 2 above, this
logic demonstrably renders the correct friendly message — confirmed directly by screenshots 2 and 3.
The one degraded render is therefore a **transient SSR-time condition**, not a client-side logic
defect.

### How this fits the already-open investigation

This file's own 2026-10-11 "ALB tail-latency investigation" entry (same DISCOVERY cycle, earlier)
measured that `getZeroDteBoardPayload()` has 7 callers besides `web-boot-warm.ts` (whose own
cold-rebuild path was gated behind `isEtExtendedWarmHours()` by the 2026-10-08 fix) — among them the
`/api/market/zerodte/board` route itself, i.e. exactly the request `/nighthawk`'s SSR path and its
first client poll depend on. Any of those 7 callers hitting a shared board snapshot that's gone
stale (off-hours, low traffic — plausible on a quiet Sunday) still pays the "cold rebuild" cost that
entry already named as structurally unprotected outside warm hours. A single slow/cold SSR render
reading a not-yet-rebuilt snapshot, landing in the `degraded` branch, then the very next
poll/hydration reading the freshly-rebuilt (or now Redis-fast) snapshot cleanly, is consistent with
every symptom observed here: one bad render, then clean on every subsequent independent check.

### What this adds (and does not add) to the existing investigation

**Adds**: the first real, visual, member-facing confirmation that the mechanism that entry inferred
from CloudWatch correlation actually produces a user-visible symptom (a brief "data unavailable"
flash), not just a backend metric. **Does not add**: proof of the specific blocking call (still
unmeasured — ALB access logging remains disabled per the existing entry), or a fix. Same "no gate/
code changed" discipline as every other investigation-only entry in this file this week.

### Next step for whoever picks up the parent investigation

No new action beyond what the existing 2026-10-11 ALB entry already recommends (gate the remaining
`getZeroDteBoardPayload()` callers' cold-rebuild fallback behind `isEtExtendedWarmHours()`, or push
the off-hours short-circuit into `getZeroDteBoardPayload()`/`runColdBoardBuild()` itself). This entry
exists so a future session doesn't have to re-derive "does this actually show up in the UI" from
scratch — it does, rarely, and self-corrects within one poll cycle.
