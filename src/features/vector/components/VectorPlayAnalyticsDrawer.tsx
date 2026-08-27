"use client";

import clsx from "clsx";
import { Drawer } from "@/components/ui";
import type { VectorPlay, VectorPlayEmit } from "@/features/vector/lib/vector-play-engine";
import type { VectorRegime } from "@/features/vector/lib/vector-regime";
import type { GammaMagnet } from "@/features/vector/lib/vector-gamma-magnet";
import type { WallProximity } from "@/features/vector/lib/vector-wall-proximity";
import type { WallIntegrity } from "@/features/vector/lib/vector-wall-integrity";

export type VectorPlayAnalyticsContext = {
  ticker: string;
  play: VectorPlay | null;
  playEmit: VectorPlayEmit | null;
  regime: VectorRegime | null;
  magnet: GammaMagnet | null;
  proximity: WallProximity | null;
  expectedMove: string[];
  confluence: string[] | null;
  wallIntegrity: { call: WallIntegrity | null; put: WallIntegrity | null };
};

type Props = VectorPlayAnalyticsContext & {
  open: boolean;
  onClose: () => void;
};

function fmtLevel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="vector-play-analytics-stat">
      <span className="vector-play-analytics-stat-label">{label}</span>
      <span className="vector-play-analytics-stat-value">{value}</span>
      {detail ? <span className="vector-play-analytics-stat-detail">{detail}</span> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="vector-play-analytics-section">
      <h3 className="vector-play-analytics-section-title">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Full desk analytics for the active play — regime, structure, confluence, walls, and watch list.
 * Institutional layout: monospace section codes, no emoji, dense stat tiles.
 */
export function VectorPlayAnalyticsDrawer({
  open,
  onClose,
  ticker,
  play,
  playEmit,
  regime,
  magnet,
  proximity,
  expectedMove,
  confluence,
  wallIntegrity,
}: Props) {
  const zones = playEmit?.confluenceZones ?? [];

  return (
    <Drawer open={open} onClose={onClose} title={`${ticker} desk analytics`} size="lg">
      <div className="vector-play-analytics">
        {play ? (
          <div className="vector-play-analytics-hero">
            <div className="vector-play-analytics-hero-grade">
              <span className="vector-play-analytics-grade">{play.grade}</span>
              <span className="vector-play-analytics-conviction">{play.conviction}%</span>
            </div>
            <div>
              <p className="vector-play-analytics-headline">{play.headline}</p>
              <p className="vector-play-analytics-thesis">{play.thesis}</p>
            </div>
          </div>
        ) : (
          <p className="vector-play-analytics-empty">No active play — waiting for structure and spot.</p>
        )}

        <div className="vector-play-analytics-stat-grid">
          <StatTile label="Spot" value={fmtLevel(playEmit?.spot)} />
          <StatTile label="Gamma flip" value={fmtLevel(playEmit?.gammaFlip)} />
          <StatTile label="Call wall" value={fmtLevel(playEmit?.callWall)} />
          <StatTile label="Put wall" value={fmtLevel(playEmit?.putWall)} />
          <StatTile label="Magnet" value={fmtLevel(playEmit?.magnetStrike ?? magnet?.strike)} />
          <StatTile
            label="Regime"
            value={regime?.headline ?? "—"}
            detail={regime?.read}
          />
        </div>

        {regime ? (
          <Section title="Gamma regime">
            <p className="vector-play-analytics-prose">{regime.read}</p>
          </Section>
        ) : null}

        {magnet ? (
          <Section title="Gamma magnet">
            <p className="vector-play-analytics-prose">
              {magnet.strike != null ? `${fmtLevel(magnet.strike)} · ${magnet.posture} · ${magnet.nearness}` : magnet.read}
            </p>
          </Section>
        ) : null}

        {proximity ? (
          <Section title="Wall proximity">
            <p className="vector-play-analytics-prose">
              {proximity.side.toUpperCase()} {fmtLevel(proximity.strike)} · {proximity.nearness}
              {proximity.pct != null ? ` · ${proximity.pct.toFixed(2)}% from spot` : ""}
            </p>
          </Section>
        ) : null}

        {expectedMove.length ? (
          <Section title="Expected move">
            <ul className="vector-play-analytics-list">
              {expectedMove.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Section>
        ) : null}

        {confluence?.length ? (
          <Section title="Confluence stack">
            <ul className="vector-play-analytics-list">
              {confluence.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Section>
        ) : null}

        {zones.length ? (
          <Section title="Confluence zones">
            <dl className="vector-play-analytics-dl">
              {zones.slice(0, 6).map((z) => (
                <div key={`${z.strike}-${z.score}`} className="vector-play-analytics-dl-row">
                  <dt>{fmtLevel(z.strike)}</dt>
                  <dd>
                    score {z.score}
                    {z.tags?.length ? ` · ${z.tags.join(", ")}` : ""}
                  </dd>
                </div>
              ))}
            </dl>
          </Section>
        ) : null}

        {(wallIntegrity.call || wallIntegrity.put) && (
          <Section title="Wall integrity">
            <dl className="vector-play-analytics-dl">
              {wallIntegrity.call ? (
                <div className="vector-play-analytics-dl-row">
                  <dt>Call {fmtLevel(wallIntegrity.call.strike)}</dt>
                  <dd>
                    {wallIntegrity.call.tier} · {wallIntegrity.call.score}% — {wallIntegrity.call.note}
                  </dd>
                </div>
              ) : null}
              {wallIntegrity.put ? (
                <div className="vector-play-analytics-dl-row">
                  <dt>Put {fmtLevel(wallIntegrity.put.strike)}</dt>
                  <dd>
                    {wallIntegrity.put.tier} · {wallIntegrity.put.score}% — {wallIntegrity.put.note}
                  </dd>
                </div>
              ) : null}
            </dl>
          </Section>
        )}

        {play?.starred?.length ? (
          <Section title="Watch now">
            <ul className="vector-play-analytics-list vector-play-analytics-watch">
              {play.starred.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </Drawer>
  );
}
