import type { ToolKey } from "@/lib/tool-access";
import { TOOLS } from "@/lib/tool-access";

/** Per-user override stored in Clerk `publicMetadata.tool_access`. */
export type ToolAccessMode = "inherit" | "grant" | "block";

export type ToolAccessMap = Partial<Record<ToolKey, ToolAccessMode>>;

const VALID_KEYS = new Set<ToolKey>(TOOLS.map((t) => t.key));

export function parseToolAccessMap(raw: unknown): ToolAccessMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ToolAccessMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!VALID_KEYS.has(k as ToolKey)) continue;
    if (v === "grant" || v === "block" || v === "inherit") {
      out[k as ToolKey] = v;
    }
  }
  return out;
}

/**
 * Strict allowlist for the admin tool-access PATCH — unlike `parseToolAccessMap` (which
 * silently drops an unrecognized tool key or mode, by design, since it also reads back
 * already-persisted Clerk metadata this app itself wrote), an admin mutation must REJECT a
 * malformed/mistyped entry rather than silently no-op it with a 200 success response. Mirrors
 * `parseAdminUserTier`'s reasoning in `admin-users.ts`.
 */
export function parseAdminToolAccessPatch(raw: unknown): ToolAccessMap | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  // Accumulate in a Map, not a plain/null-prototype object: CodeQL's property-injection query
  // flags ANY `obj[k] = v` bracket-assignment whose key comes from a loop over untrusted input,
  // even when `VALID_KEYS.has(k)` already restricts it to a fixed, hardcoded tool-key allowlist
  // (confirmed live — an `Object.create(null)` accumulator still triggered the same alert, since
  // the query targets the bracket-assignment syntax itself, not the object's prototype). A
  // `Map.set()` call isn't a property write at all in the sense this rule tracks, so it's outside
  // the query's scope entirely. `Object.fromEntries` at the end converts to the plain object
  // callers/tests expect, through an API that again isn't a per-key bracket assignment.
  const out = new Map<ToolKey, ToolAccessMode>();
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!VALID_KEYS.has(k as ToolKey)) return undefined;
    if (v !== "grant" && v !== "block" && v !== "inherit") return undefined;
    out.set(k as ToolKey, v);
  }
  return Object.fromEntries(out);
}

/** Effective tool access for a non-admin user (admin callers should bypass before this). */
export function resolveToolAccessForUser(
  key: ToolKey,
  globallyLaunched: boolean,
  overrides: ToolAccessMap | undefined
): boolean {
  const mode = overrides?.[key] ?? "inherit";
  if (mode === "grant") return true;
  if (mode === "block") return false;
  return globallyLaunched;
}

/** Strip inherit entries before persisting to Clerk metadata. */
export function compactToolAccessMap(map: ToolAccessMap): Record<string, ToolAccessMode> {
  const out: Record<string, ToolAccessMode> = {};
  for (const [k, v] of Object.entries(map) as Array<[ToolKey, ToolAccessMode | undefined]>) {
    if (v && v !== "inherit") out[k] = v;
  }
  return out;
}

export function emptyToolAccessMap(): Record<ToolKey, ToolAccessMode> {
  return Object.fromEntries(TOOLS.map((t) => [t.key, "inherit" as const])) as Record<
    ToolKey,
    ToolAccessMode
  >;
}

export function mergeToolAccessMap(
  base: ToolAccessMap | undefined,
  patch: ToolAccessMap
): ToolAccessMap {
  const next = { ...emptyToolAccessMap(), ...base, ...patch };
  for (const t of TOOLS) {
    if (next[t.key] === "inherit") delete next[t.key];
  }
  return next;
}

export type ToolAccessRow = {
  key: ToolKey;
  label: string;
  href: string;
  globalLaunched: boolean;
  mode: ToolAccessMode;
  effective: boolean;
};

export function buildToolAccessRows(
  globallyLaunched: (key: ToolKey) => boolean,
  overrides: ToolAccessMap | undefined
): ToolAccessRow[] {
  return TOOLS.map((t) => {
    const mode = overrides?.[t.key] ?? "inherit";
    const globalLaunched = globallyLaunched(t.key);
    return {
      key: t.key,
      label: t.label,
      href: t.href,
      globalLaunched,
      mode,
      effective: resolveToolAccessForUser(t.key, globalLaunched, overrides),
    };
  });
}
