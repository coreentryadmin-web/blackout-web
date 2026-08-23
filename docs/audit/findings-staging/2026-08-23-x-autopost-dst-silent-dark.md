# 2026-08-23 — x-autopost DST defect: silent dark Nov 1 – Mar 9

> **kind:** FINDING

## Claim

x-autopost publishes posts every 2 hours during trading hours. This is true under EDT (June–Oct) but false under EST (Nov–Mar): the cron fires UTC `0 12,14,16,18,20,22,0 * * *` while the gate checks ET hour ∈ {8,10,12,14,16,18,20}. Under EST, UTC noon = ET 7am (outside gate); the cron still fires but `isPostWindow()` self-skips and returns 200 silently.

## Evidence

**Measurement:** `scripts/audit/cron-dst-audit.mjs` run 2026-08-23 22:15 UTC

```
x-autopost                  0 12,14,16,18,20,22,0 * * *   39    0     BROKEN
  fires/week             : 49  →  in-window EDT 39 · EST 0
  gate source            : src/lib/x-content-schedule.ts
  Zero satisfying fires under EST — the job goes silently dark for that half of the year
```

**Root cause:** Line in `src/lib/x-content-schedule.ts`:

```typescript
// BROKEN: checks ET hour, but cron fires UTC
if (!isPostWindow()) return 200;  // silent skip

function isPostWindow(): boolean {
  const etHour = // ... convert UTC to ET
  return [8, 10, 12, 14, 16, 18, 20].includes(etHour);
}
```

Under EDT (UTC-4): UTC 12:00 → ET 8:00 ✓  
Under EST (UTC-5): UTC 12:00 → ET 7:00 ✗

**Blast radius:** Every UTC hour slot misses its gate during EST. Since the schedule has no per-half-year adjustment, this is **endemic**: 2026-11-01 (DST ends) through 2026-03-09 (DST resumes) = **130 days with zero in-window fires**.

## Status

UNFIXED, CONFIRMED, BLOCKING PUBLICATION

## Reproduction

```bash
node --import tsx scripts/audit/cron-dst-audit.mjs
# Shows: x-autopost BROKEN (39 EDT, 0 EST)
```

## Fix Options

**Option A (Simplest):** Adjust cron schedule per half-year  
- EDT (Mar 9 – Nov 1): `0 12,14,16,18,20,22,0 * * *`
- EST (Nov 1 – Mar 9): `0 13,15,17,19,21,23,1 * * *` (shift each by +1)
- Risk: humans must remember to change twice yearly
- Evidence: x-autopost already requires manual schedule management in EventBridge

**Option B (Robust):** Single source of truth — hourly fire + gate  
- Cron: `0 * * * *` (fire every hour)
- Gate: `isPostWindow()` returns false outside intended ET hours (both EDT and EST)
- Advantage: DST-agnostic, requires no schedule changes
- Risk: 2-hour window becomes 1-hour window (may increase rate pressure)

**Option C (Current approach, acknowledged broken):** Fix the gate to know DST  
- `isPostWindow()` computes ET correctly for both offsets
- Cron stays `0 12,14,16,18,20,22,0 * * *`
- Risk: gate complexity increases; unclear if EventBridge or cron is source of truth

## Authority

**BLOCKER:** Brief `docs/agents/briefs/x-content.md` §Publishing Authority states: "Do not change the state of the existing autopost pipeline — do not pause it, do not unpause it, do not retune its schedule."

This finding is a P0, but changing the cron schedule violates the brief unless explicitly authorized. Mandate `docs/audit/certification-mandates/X-CONTENT.md` calls for certification but pre-dates any approval to fix the defect itself.

**Action required:** User confirmation that x-autopost fix is approved, or mark as KNOWN BLOCKER with eta for authorization.

---

**Impact:** Zero posts every evening in winter; account silent Nov–Mar  
**Surface:** Public X account  
**Likelihood:** 100% (will occur)  
**Detectability:** Low (silent HTTP 200)  
**Deployed version:** Production (EventBridge + src/lib)  
**Commit:** Latest in main
