"use client";

import { FreshnessChip } from "@/components/ui";
import { etClock } from "@/lib/et-clock";

/**
 * Compact desk header. Deliberately carries NO metrics: `catalystCount` and `next24h` used to
 * render here as a "Window / Next 24h" pair, but `meridian-stats-strip` prints the identical two
 * numbers in the row immediately below it. Two readings of one value, ~10px apart, is a source of
 * doubt rather than information — if they ever disagreed (different render pass, different
 * rounding) a member has no way to tell which one is the board. The strip is the single place
 * those counts live now.
 */
type Props = {
  asOf?: string;
};

export function MeridianHero({ asOf }: Props) {
  return (
    <header className="meridian-hero">
      <div className="meridian-hero-mesh" aria-hidden="true">
        <div className="meridian-hero-orb meridian-hero-orb-a" />
        <div className="meridian-hero-orb meridian-hero-orb-b" />
        <div className="meridian-hero-orb meridian-hero-orb-c" />
        <div className="meridian-hero-grid" />
      </div>

      <div className="meridian-hero-content">
        <div className="meridian-hero-left">
          <p className="meridian-hero-kicker">
            <span className="meridian-hero-pulse" aria-hidden="true" />
            Catalyst structure desk
          </p>
          <h1 className="meridian-hero-title">
            <span className="meridian-hero-title-main">Meridian</span>
            <span className="meridian-hero-title-sub">Event analytics</span>
          </h1>
          <p className="meridian-hero-tagline">
            Macro prints, earnings, FDA, and OpEx — structure, flow, and historical reaction in one lane.
          </p>
        </div>

        <div className="meridian-hero-right">
          <div className="meridian-hero-badge-row">
            <span className="meridian-hero-mark" aria-hidden="true">
              ✦
            </span>
            <FreshnessChip status="live" label="Live structure" />
          </div>
          {asOf && (
            <p className="meridian-hero-asof">
              {/* The " ET" below is a literal, so the time beside it MUST be Eastern. It was not:
                  the formatter omitted `timeZone`, so this line asserted a zone it was not rendering
                  in — "As of 07:30 PM ET" for a London member at 2:30 PM ET. */}
              As of {etClock(asOf, { pad: true }) ?? "—"} ET
            </p>
          )}
        </div>
      </div>
    </header>
  );
}
