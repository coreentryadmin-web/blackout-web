/**
 * Starter cards for the Largo empty state + composer — desk drill-down → submodules.
 * Client-safe (static metadata from slash-submodules + desk-scope).
 */

import { deskScopeConfig } from "@/lib/largo/desk-scope";
import type { DeskScopeKey } from "@/lib/largo/desk-scope";
import { submodulesForDesk } from "@/lib/largo/slash-submodules";

export type LargoStarterPick = {
  question: string;
  deskScope: string;
  deskScopeArgs: import("@/lib/largo/desk-scope").DeskSlashArgs;
};

/** Set desk/submodule scope without sending — member types their own question next. */
export type LargoScopePick = {
  deskScope: string;
  deskScopeArgs?: import("@/lib/largo/desk-scope").DeskSlashArgs;
  /** Prefill composer, e.g. `/spx-slayer /gex ` — omit to leave input unchanged. */
  prefill?: string;
};

/** Visible composer prefix when desk (+ optional submodule) scope is active. */
export function formatLargoScopePrefill(desk: string, submodule?: string | null): string {
  const root = desk.trim().replace(/^\//, "");
  if (!root) return "";
  if (submodule?.trim()) {
    const sub = submodule.trim().replace(/^\//, "");
    return `/${root} /${sub} `;
  }
  return `/${root} `;
}

export type LargoModuleStarterCard = {
  id: string;
  desk: DeskScopeKey;
  deskLabel: string;
  submodule: string;
  moduleLabel: string;
  label: string;
  hint: string;
  question: string;
};

export type LargoDeskStarterCard = {
  id: DeskScopeKey;
  label: string;
  description: string;
  moduleCount: number;
  /** Slash token for composer hint */
  command: string;
};

/** Product desks shown in the first drill-down step (matches slash navigate commands). */
const DESK_ORDER: DeskScopeKey[] = [
  "spx-slayer",
  "helix",
  "thermal",
  "vector",
  "nighthawk",
  "meridian",
  "largo",
  "track-record",
];

const DESK_BLURBS: Partial<Record<DeskScopeKey, string>> = {
  "spx-slayer": "0DTE play engine, GEX, pulse, pin, gates, lotto, internals",
  helix: "Institutional options flow tape and whale prints",
  thermal: "Dealer gamma, vanna matrix, positioning",
  vector: "Live chart structure, walls, play card",
  nighthawk: "0DTE board, marks, discovery funnel",
  meridian: "Catalyst calendar, earnings, macro events",
  largo: "Cross-desk trinity, conflicts, morning brief",
  "track-record": "Graded outcomes, win rate, setup stats",
};

export function largoDeskStarterCards(): LargoDeskStarterCard[] {
  const out: LargoDeskStarterCard[] = [];
  for (const id of DESK_ORDER) {
    const cfg = deskScopeConfig(id);
    const mods = submodulesForDesk(id);
    if (!cfg || !mods.length) continue;
    out.push({
      id,
      label: cfg.label,
      description: DESK_BLURBS[id] ?? mods[0]?.description ?? "",
      moduleCount: mods.length,
      command: id,
    });
  }
  return out;
}

/** Every submodule for a desk — second drill-down step. */
export function largoSubmoduleCardsForDesk(desk: DeskScopeKey): LargoModuleStarterCard[] {
  const cfg = deskScopeConfig(desk);
  if (!cfg) return [];
  const ticker = cfg.defaultTicker;
  return submodulesForDesk(desk).map((mod) => ({
    id: `${desk}-${mod.id}`,
    desk,
    deskLabel: cfg.label,
    submodule: mod.id,
    moduleLabel: mod.label,
    label: `${cfg.label} · ${mod.label}`,
    hint: mod.description,
    question: mod.defaultQuestion(ticker),
  }));
}

/** @deprecated Use desk drill-down — kept for tests referencing flat list length. */
export function largoModuleStarterCards(): LargoModuleStarterCard[] {
  return DESK_ORDER.flatMap((d) => largoSubmoduleCardsForDesk(d));
}

/** Compact composer: show desk names only until one is selected. */
export function largoModuleComposerDesks(): LargoDeskStarterCard[] {
  return largoDeskStarterCards().filter((d) =>
    ["spx-slayer", "helix", "thermal", "vector", "nighthawk", "meridian"].includes(d.id)
  );
}
