"use client";

/**
 * POSITIONING — how money is positioned INTO the event.
 *
 * Built on what the audit measured as present for liquid names: thermal 100%, dark pool 100%
 * (8 prints), expected move 100%. `flow_into_print` is only 60% filled and thin when present
 * (mean under one print), so it is a SECONDARY strip with an honest empty state rather than a
 * headline panel — the brief asked for proportional call/put flow bars, and the data cannot
 * carry them as a primary surface.
 */

import { useState } from "react";
import type { MeridianEarningsIntel } from "@/features/meridian/lib/meridian-types";
import {
  MeridianDarkPoolTape,
  MeridianMoveRail,
  MeridianStrikeProfile,
  MeridianStructureLadder,
  type RailMarker,
} from "./meridian-viz";

export function MeridianEarningsPositioningPanel({
  ticker,
  intel,
}: {
  ticker: string;
  intel: MeridianEarningsIntel;
}) {
  const { thermal, dark_pool: darkPool, flow_into_print: flow } = intel;
  // One hovered price, shared by the ladder, the strike profile and the move rail — three
  // views of the same book, so a level highlighted in one must locate itself in the others.
  const [hoverPrice, setHoverPrice] = useState<number | null>(null);

  const markers: RailMarker[] = [
    { value: thermal?.call_wall ?? null, label: "call wall", kind: "wall" as const },
    { value: thermal?.put_wall ?? null, label: "put wall", kind: "wall" as const },
    { value: thermal?.gex_king_strike ?? null, label: "king", kind: "level" as const },
    { value: thermal?.max_pain ?? null, label: "max pain", kind: "level" as const },
  ].filter((m) => m.value != null);

  return (
    <section className="mp" aria-label={`${ticker} positioning`}>
      <div className="mr-grid">
        <div className="mr-panel mr-panel-wide">
          <MeridianMoveRail
            band={intel.expected_move_band}
            movePct={intel.expected_move_pct}
            markers={hoverPrice === null ? markers : [...markers, { value: hoverPrice, label: "◆", kind: "level" as const }]}
            source={intel.expected_move_source ?? undefined}
          />
        </div>

        {thermal?.available && (
          <>
            <div className="mr-panel">
              <span className="mr-panel-title">Dealer structure</span>
              <MeridianStructureLadder thermal={thermal} onLevelHover={setHoverPrice} />
              {thermal.net_gex_label && (
                <p className="mv-note">
                  net GEX {thermal.net_gex_label}
                  {thermal.gamma_regime ? ` · ${thermal.gamma_regime}` : ""}
                  {thermal.nearest_wall
                    ? ` · nearest ${thermal.nearest_wall.kind} ${thermal.nearest_wall.strike}`
                    : ""}
                </p>
              )}
            </div>

            <div className="mr-panel">
              <MeridianStrikeProfile
                rows={thermal.top_strikes}
                spot={thermal.spot}
                onStrikeHover={setHoverPrice}
              />
            </div>
          </>
        )}

        {darkPool?.available && (
          <div className="mr-panel">
            <MeridianDarkPoolTape prints={darkPool.top_prints} totalLabel={darkPool.total_premium_label} />
            {darkPool.detail && <p className="mv-note">{darkPool.detail}</p>}
          </div>
        )}

        <div className="mr-panel">
          <span className="mr-panel-title">Options flow into print</span>
          {flow?.available && (flow.top_prints?.length ?? 0) > 0 ? (
            <>
              {flow.net_premium_label && (
                <p className="mp-flow-net">
                  net {flow.net_premium_label} · {flow.bias} · {flow.window_hours}h window
                </p>
              )}
              <ul className="mp-flow-list">
                {flow.top_prints.map((p, i) => (
                  <li key={`${p.strike}-${p.expiry}-${i}`}>
                    <span className={p.option_type === "call" ? "mv-bull" : p.option_type === "put" ? "mv-bear" : ""}>
                      {p.option_type ?? "—"}
                    </span>
                    <span>{p.strike ?? "—"}</span>
                    <span>{p.premium_label}</span>
                    <span className="mp-flow-dte">{p.dte != null ? `${p.dte}d` : ""}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            // Honest empty state. Measured 60% availability and under one print on average even
            // when present — most names simply have no pre-print sweep worth showing, and a
            // fabricated bar chart of nothing would be worse than saying so.
            <p className="mv-note">No qualifying pre-print options flow in the window.</p>
          )}
        </div>
      </div>
    </section>
  );
}
