/**
 * The answer-mode VALUE half of largo-depth, kept free of server-only imports.
 *
 * WHY THIS FILE EXISTS. `largo-depth.ts` imports COMMENTARY_MODEL / LARGO_MODEL from
 * `@/lib/providers/anthropic`, which reaches `api-telemetry` → `api-telemetry-persist`, and that
 * module starts with `import "server-only"`. Pulling ANY runtime value out of `largo-depth.ts`
 * from a client component therefore drags `server-only` into the browser bundle and the Next
 * build fails:
 *
 *   ./src/lib/api-telemetry-persist.ts
 *   Error: You're importing a component that needs "server-only"
 *   Import trace: largo-depth.ts → useLargoChat.ts → LargoNativeTerminal.tsx → LargoPageShell.tsx
 *
 * Type-only imports are erased before bundling, so the several components that do
 * `import type { LargoDepth }` were always fine — it is the first VALUE import from a client
 * module that breaks the build. `useLargoChat.ts` needs `normalizeLargoDepth` to read the legacy
 * localStorage value, so that function and the type live here, and `largo-depth.ts` re-exports
 * them so every existing import path keeps working.
 *
 * Keep this module free of imports that are not themselves client-safe. `largoDepthConfig` and
 * `formatDepthBlock` deliberately stay in `largo-depth.ts` — they select a model and build the
 * prompt, both server concerns.
 */

export type LargoDepth = "concrete" | "deep";

/** Legacy client storage used "quick" before the Concrete rename. */
export function normalizeLargoDepth(raw: unknown): LargoDepth {
  if (raw === "concrete" || raw === "quick") return "concrete";
  return "deep";
}

export function parseLargoDepth(raw: unknown): LargoDepth {
  return normalizeLargoDepth(raw);
}
