## `storeAge()` carried a dead conditional branch — two age bands returned byte-identical results — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Where** | `src/components/admin/admin-store-age.ts`, `storeAge()` |
| **Symptom** | `if (m < 15) return { label: \`${m}m ago\`, ok: false };` was immediately followed by a fallthrough `return { label: \`${m}m ago\`, ok: false };` — identical label expression, identical `ok` value. No caller or test could ever observe a difference between "5-14 minutes stale" and "15+ minutes stale"; the `m < 15` check was pure dead weight. |
| **Root cause** | Minor leftover from presumably an earlier three-tier design (e.g. a planned intermediate "warning" state between the `m < 5` healthy band and a stale band) that never diverged in its return value before shipping. |
| **Fix** | Removed the redundant `if (m < 15)` branch; the single fallthrough `return` already covers every `m >= 5` case with the exact same output. Zero behavior change — confirmed via the existing `admin-store-age.test.ts` (3/3 pass unchanged) and `tsc --noEmit` clean. |
| **Blast radius** | None — pure dead-code removal, same observable output for every input. |
| **Gates** | `tsc --noEmit` clean. `admin-store-age.test.ts`: 3/3 pass (unchanged — no new test needed since there is no new behavior to cover, only a removed no-op branch). |
| **Status** | FIXED |
