# Admin SPX dashboard stale banner — future-skew guard

> **kind:** FINDING

## Symptom

`AdminSpxDashboard` computed `staleMs = Date.now() - new Date(generated_at)` with no future guard. A clock-skewed future `generated_at` produced a negative age → falsely **not stale**.

## Fix

`adminAgeMsFromIso()` in `admin-time-ago.ts`; SPX dashboard treats `null` age (skew/invalid) as stale.

| **Status** | FIXED — PR pending |
