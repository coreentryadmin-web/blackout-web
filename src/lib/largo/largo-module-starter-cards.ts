/**
 * Starter cards for the Largo empty state + composer chips — wired to desk submodules.
 * Client-safe (static metadata from slash-submodules).
 */

import { deskScopeConfig } from "@/lib/largo/desk-scope";
import type { DeskScopeKey } from "@/lib/largo/desk-scope";
import { resolveSubmodule } from "@/lib/largo/slash-submodules";

export type LargoModuleStarterCard = {
  id: string;
  desk: DeskScopeKey;
  deskLabel: string;
  submodule: string;
  moduleLabel: string;
  /** Card title — desk · module */
  label: string;
  hint: string;
  question: string;
};

/** Curated first-run cards — one high-signal module per desk + a few cross-desk favorites. */
const STARTER_PICKS: Array<{ desk: DeskScopeKey; submodule: string; hint?: string }> = [
  { desk: "spx-slayer", submodule: "gex", hint: "Flip, walls, king strike, gamma regime" },
  { desk: "spx-slayer", submodule: "play", hint: "Phase, action, grade, gate status" },
  { desk: "helix", submodule: "tape", hint: "Net premium, bias, tape skew" },
  { desk: "thermal", submodule: "positioning", hint: "Dealer flip, walls, net GEX" },
  { desk: "vector", submodule: "structure", hint: "Flip, walls, key levels" },
  { desk: "nighthawk", submodule: "board", hint: "Open 0DTE plays and marks" },
  { desk: "meridian", submodule: "calendar", hint: "Today's catalysts and timing" },
  { desk: "largo", submodule: "trinity", hint: "SPX · SPY · QQQ side by side" },
  { desk: "spx-slayer", submodule: "flow-gex", hint: "Where flow and GEX agree or conflict" },
  { desk: "nighthawk", submodule: "marks", hint: "Live P&L and stopped positions" },
];

export function largoModuleStarterCards(): LargoModuleStarterCard[] {
  const out: LargoModuleStarterCard[] = [];
  for (const pick of STARTER_PICKS) {
    const cfg = deskScopeConfig(pick.desk);
    const mod = resolveSubmodule(pick.desk, pick.submodule);
    if (!cfg || !mod) continue;
    const ticker = cfg.defaultTicker;
    out.push({
      id: `${pick.desk}-${mod.id}`,
      desk: pick.desk,
      deskLabel: cfg.label,
      submodule: mod.id,
      moduleLabel: mod.label,
      label: `${cfg.label} · ${mod.label}`,
      hint: pick.hint ?? mod.description,
      question: mod.defaultQuestion(ticker),
    });
  }
  return out;
}

/** Compact composer row — top 6 modules members reach for most. */
export function largoModuleComposerChips(): LargoModuleStarterCard[] {
  return largoModuleStarterCards().slice(0, 6);
}
