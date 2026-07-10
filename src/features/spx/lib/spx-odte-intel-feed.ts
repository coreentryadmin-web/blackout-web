/**
 * 0DTE intel feed — material desk deltas only (anchor, γ flip, walls, big flow).
 * Pure functions so the Playbook terminal can scroll important events without noise.
 */
import type { SpxDeskPayload, SpxFlowBrief } from "@/features/spx/lib/spx-desk";
import type { GexWall } from "@/lib/providers/gamma-desk";
import type { PlayTerminalLine } from "@/features/spx/lib/spx-play-terminal-lines";
import { fmtPrice } from "@/lib/api";

/** Minimum premium for a single flow print to surface in the intel feed. */
export const INTEL_FLOW_PREMIUM_MIN = 500_000;
/** Sweep prints can be a bit smaller and still matter. */
export const INTEL_SWEEP_PREMIUM_MIN = 250_000;
/** Absolute 0DTE net-flow delta that counts as a material shift. */
export const INTEL_FLOW_NET_DELTA_MIN = 150_000;
/** Absolute GEX net change (dollars) that counts as material. */
export const INTEL_GEX_NET_DELTA_MIN = 500_000_000;

export type OdteIntelEvent = {
  id: string;
  at: string;
  kind:
    | "anchor"
    | "flip"
    | "call_wall"
    | "put_wall"
    | "flow_print"
    | "flow_net"
    | "gex_net"
    | "spot_cross";
  line: PlayTerminalLine;
};

function moneyShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function wallByKind(walls: GexWall[] | undefined, kind: "support" | "resistance"): GexWall | null {
  if (!walls?.length) return null;
  const matches = walls.filter((w) => w.kind === kind);
  if (!matches.length) return null;
  return matches.reduce((best, w) => (Math.abs(w.net_gex) > Math.abs(best.net_gex) ? w : best));
}

function flowKey(f: SpxFlowBrief): string {
  return `${f.alerted_at}|${f.strike}|${f.premium}|${f.option_type}|${f.has_sweep ? 1 : 0}`;
}

function isMaterialFlow(f: SpxFlowBrief): boolean {
  if (!Number.isFinite(f.premium)) return false;
  if (f.has_sweep && Math.abs(f.premium) >= INTEL_SWEEP_PREMIUM_MIN) return true;
  return Math.abs(f.premium) >= INTEL_FLOW_PREMIUM_MIN;
}

/**
 * Diff two desk snapshots → material 0DTE intel events (newest last).
 * Pass `prev=null` on first tick to seed current structure without flooding.
 */
export function diffOdteIntelEvents(
  prev: SpxDeskPayload | null | undefined,
  next: SpxDeskPayload | null | undefined,
  opts?: { seed?: boolean }
): OdteIntelEvent[] {
  if (!next?.available || !(next.price > 0)) return [];
  const at = next.as_of || new Date().toISOString();
  const events: OdteIntelEvent[] = [];
  const seed = Boolean(opts?.seed || !prev);

  const push = (kind: OdteIntelEvent["kind"], line: PlayTerminalLine, key: string) => {
    events.push({ id: `${kind}|${key}|${at}`, at, kind, line });
  };

  // --- Anchor (GEX king) ---
  if (next.gex_king != null) {
    if (seed) {
      push(
        "anchor",
        {
          icon: "gamma",
          tone: "accent",
          text: `ANCHOR ${fmtPrice(next.gex_king)} · max |GEX| node`,
          indent: 1,
        },
        String(next.gex_king)
      );
    } else if (prev?.gex_king != null && prev.gex_king !== next.gex_king) {
      push(
        "anchor",
        {
          icon: "gamma",
          tone: "warn",
          text: `ANCHOR migrated ${fmtPrice(prev.gex_king)} → ${fmtPrice(next.gex_king)}`,
          indent: 1,
        },
        `${prev.gex_king}->${next.gex_king}`
      );
    } else if (prev?.gex_king == null) {
      push(
        "anchor",
        {
          icon: "gamma",
          tone: "accent",
          text: `ANCHOR locked ${fmtPrice(next.gex_king)}`,
          indent: 1,
        },
        String(next.gex_king)
      );
    }
  }

  // --- γ Flip ---
  if (next.gamma_flip != null) {
    if (seed) {
      const side = next.above_gamma_flip ? "above" : "below";
      push(
        "flip",
        {
          icon: "level",
          tone: next.above_gamma_flip ? "bull" : "bear",
          text: `γ FLIP ${fmtPrice(next.gamma_flip)} · spot ${side}`,
          indent: 1,
        },
        String(next.gamma_flip)
      );
    } else if (prev?.gamma_flip != null && Math.abs(prev.gamma_flip - next.gamma_flip) >= 0.5) {
      push(
        "flip",
        {
          icon: "level",
          tone: "warn",
          text: `γ FLIP shifted ${fmtPrice(prev.gamma_flip)} → ${fmtPrice(next.gamma_flip)}`,
          indent: 1,
        },
        `${prev.gamma_flip}->${next.gamma_flip}`
      );
    }

    if (
      !seed &&
      prev &&
      next.gamma_flip != null &&
      prev.above_gamma_flip !== next.above_gamma_flip
    ) {
      push(
        "spot_cross",
        {
          icon: "pulse",
          tone: next.above_gamma_flip ? "bull" : "bear",
          text: next.above_gamma_flip
            ? `SPOT crossed ABOVE γ flip ${fmtPrice(next.gamma_flip)}`
            : `SPOT crossed BELOW γ flip ${fmtPrice(next.gamma_flip)}`,
          indent: 1,
        },
        `cross-${next.above_gamma_flip}`
      );
    }
  }

  // --- Call / put walls (resistance = call-side, support = put-side) ---
  const nextCall = wallByKind(next.gex_walls, "resistance");
  const nextPut = wallByKind(next.gex_walls, "support");
  const prevCall = wallByKind(prev?.gex_walls, "resistance");
  const prevPut = wallByKind(prev?.gex_walls, "support");

  if (nextCall) {
    if (seed) {
      push(
        "call_wall",
        {
          icon: "level",
          tone: "bull",
          text: `CALL WALL ${fmtPrice(nextCall.strike)} · ${moneyShort(nextCall.net_gex)}`,
          indent: 1,
        },
        String(nextCall.strike)
      );
    } else if (!prevCall || prevCall.strike !== nextCall.strike) {
      push(
        "call_wall",
        {
          icon: "level",
          tone: "bull",
          text: prevCall
            ? `CALL WALL moved ${fmtPrice(prevCall.strike)} → ${fmtPrice(nextCall.strike)}`
            : `CALL WALL building ${fmtPrice(nextCall.strike)} · ${moneyShort(nextCall.net_gex)}`,
          indent: 1,
        },
        `${prevCall?.strike ?? "new"}->${nextCall.strike}`
      );
    } else if (Math.abs(nextCall.net_gex) > Math.abs(prevCall.net_gex) * 1.25) {
      push(
        "call_wall",
        {
          icon: "level",
          tone: "bull",
          text: `CALL WALL strengthening ${fmtPrice(nextCall.strike)} · ${moneyShort(nextCall.net_gex)}`,
          indent: 1,
        },
        `build-${nextCall.strike}-${Math.round(nextCall.net_gex)}`
      );
    }
  }

  if (nextPut) {
    if (seed) {
      push(
        "put_wall",
        {
          icon: "level",
          tone: "bear",
          text: `PUT WALL ${fmtPrice(nextPut.strike)} · ${moneyShort(nextPut.net_gex)}`,
          indent: 1,
        },
        String(nextPut.strike)
      );
    } else if (!prevPut || prevPut.strike !== nextPut.strike) {
      push(
        "put_wall",
        {
          icon: "level",
          tone: "bear",
          text: prevPut
            ? `PUT WALL moved ${fmtPrice(prevPut.strike)} → ${fmtPrice(nextPut.strike)}`
            : `PUT WALL building ${fmtPrice(nextPut.strike)} · ${moneyShort(nextPut.net_gex)}`,
          indent: 1,
        },
        `${prevPut?.strike ?? "new"}->${nextPut.strike}`
      );
    } else if (Math.abs(nextPut.net_gex) > Math.abs(prevPut.net_gex) * 1.25) {
      push(
        "put_wall",
        {
          icon: "level",
          tone: "bear",
          text: `PUT WALL strengthening ${fmtPrice(nextPut.strike)} · ${moneyShort(nextPut.net_gex)}`,
          indent: 1,
        },
        `build-${nextPut.strike}-${Math.round(nextPut.net_gex)}`
      );
    }
  }

  // --- Aggregate GEX net ---
  if (next.gex_net != null) {
    if (seed) {
      push(
        "gex_net",
        {
          icon: "gamma",
          tone: next.gex_net >= 0 ? "bull" : "bear",
          text: `NET GEX ${moneyShort(next.gex_net)}`,
          indent: 1,
        },
        String(Math.round(next.gex_net))
      );
    } else if (
      prev?.gex_net != null &&
      Math.abs(next.gex_net - prev.gex_net) >= INTEL_GEX_NET_DELTA_MIN
    ) {
      const delta = next.gex_net - prev.gex_net;
      push(
        "gex_net",
        {
          icon: "gamma",
          tone: delta >= 0 ? "bull" : "bear",
          text: `GEX ${delta >= 0 ? "+" : ""}${moneyShort(delta)} → net ${moneyShort(next.gex_net)}`,
          indent: 1,
        },
        `${Math.round(prev.gex_net)}->${Math.round(next.gex_net)}`
      );
    }
  }

  // --- 0DTE flow net ---
  if (next.flow_0dte_net != null) {
    if (
      !seed &&
      prev?.flow_0dte_net != null &&
      (Math.sign(prev.flow_0dte_net) !== Math.sign(next.flow_0dte_net) ||
        Math.abs(next.flow_0dte_net - prev.flow_0dte_net) >= INTEL_FLOW_NET_DELTA_MIN)
    ) {
      const tone = next.flow_0dte_net >= 0 ? "bull" : "bear";
      push(
        "flow_net",
        {
          icon: "flow",
          tone,
          text: `0DTE FLOW NET ${next.flow_0dte_net >= 0 ? "+" : ""}${moneyShort(next.flow_0dte_net)}`,
          indent: 1,
        },
        String(Math.round(next.flow_0dte_net))
      );
    }
  }

  // --- Massive individual prints (new only) ---
  if (!seed && prev) {
    const seen = new Set((prev.spx_flows ?? []).map(flowKey));
    for (const f of next.spx_flows ?? []) {
      if (!isMaterialFlow(f)) continue;
      const key = flowKey(f);
      if (seen.has(key)) continue;
      const side = String(f.option_type || "").toLowerCase().startsWith("c") ? "CALL" : "PUT";
      const sweep = f.has_sweep ? " SWEEP" : "";
      push(
        "flow_print",
        {
          icon: "flow",
          tone: side === "CALL" ? "bull" : "bear",
          text: `MASSIVE ${side}${sweep} ${fmtPrice(f.strike)} · ${moneyShort(f.premium)}`,
          indent: 1,
        },
        key
      );
    }
  }

  return events;
}

/** Cap ring buffer; keep newest. */
export function appendOdteIntelEvents(
  existing: OdteIntelEvent[],
  incoming: OdteIntelEvent[],
  max = 40
): OdteIntelEvent[] {
  if (!incoming.length) return existing;
  const seen = new Set(existing.map((e) => e.id));
  const merged = [...existing];
  for (const ev of incoming) {
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    merged.push(ev);
  }
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}

export function odteIntelEventsToTerminalLines(events: OdteIntelEvent[]): PlayTerminalLine[] {
  if (!events.length) {
    return [
      {
        icon: "dim",
        tone: "dim",
        text: "Listening for 0DTE structure / flow edges…",
        indent: 1,
      },
    ];
  }
  // Newest last so terminal auto-scroll shows latest
  return events.map((e) => e.line);
}
