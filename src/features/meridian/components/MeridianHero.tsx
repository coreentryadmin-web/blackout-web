"use client";

import { FreshnessChip } from "@/components/ui";

type Props = {
  catalystCount?: number;
  next24h?: number;
  asOf?: string;
};

export function MeridianHero({ catalystCount, next24h, asOf }: Props) {
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
          {(catalystCount != null || next24h != null) && (
            <dl className="meridian-hero-metrics">
              {catalystCount != null && (
                <div className="meridian-hero-metric">
                  <dt>Window</dt>
                  <dd>{catalystCount} catalysts</dd>
                </div>
              )}
              {next24h != null && (
                <div className="meridian-hero-metric meridian-hero-metric-urgent">
                  <dt>Next 24h</dt>
                  <dd>{next24h}</dd>
                </div>
              )}
            </dl>
          )}
          {asOf && (
            <p className="meridian-hero-asof">
              As of {new Date(asOf).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} ET
            </p>
          )}
        </div>
      </div>
    </header>
  );
}
