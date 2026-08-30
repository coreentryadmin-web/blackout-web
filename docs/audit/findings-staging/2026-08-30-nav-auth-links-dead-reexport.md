## 2026-08-30 — [FINDING, P4 dead-code] Deprecated dead re-export in `NavAuthLinks.tsx` — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Symptom** | `src/components/landing/NavAuthLinks.tsx` re-exported `readClientSignedIn` from `@/lib/client-signed-in`, marked `@deprecated import from '@/lib/client-signed-in'` — the re-export's own doc comment tells callers not to use it, pointing at the exact module it re-exports from. |
| **Root cause / why it's dead** | Repo-wide grep for `readClientSignedIn` confirms every real consumer (`src/components/Nav.tsx`, `src/lib/use-marketing-signed-in.ts`, `src/lib/client-signed-in.test.ts`) already imports directly from `@/lib/client-signed-in` — nothing imports it through `NavAuthLinks`. The re-export outlived whatever migration it was a shim for. |
| **Fix** | Deleted the re-export line and its doc comment from `NavAuthLinks.tsx`. No behavior change — the function itself lives on unchanged in `@/lib/client-signed-in`, already covered by `client-signed-in.test.ts`; this only removes an unused second path to it. No new test needed (nothing to regress — it's a deletion of an already-provably-unused export, verified by the same repo-wide grep any future change would also need to pass). |
| **Gates** | `npx tsc --noEmit` clean · `npx eslint` clean on the touched file · repo-wide grep confirms zero remaining references to `readClientSignedIn` via `NavAuthLinks`. |
| **Status** | FIXED |
