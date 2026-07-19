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
