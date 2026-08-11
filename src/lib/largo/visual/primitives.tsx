/**
 * VISUAL PRIMITIVES — the reusable building blocks every template composes from.
 *
 * SATORI CONSTRAINTS, stated once here because they shape every component below:
 *   - FLEXBOX ONLY. No CSS grid, no container queries, no floats. Any element with more than one
 *     child MUST declare `display: flex` explicitly — satori does not default to it and silently
 *     mis-lays out when it is missing. That single rule is the most common source of a broken card.
 *   - No `gap` shorthand on some versions — spacing uses explicit margins, which is why the row
 *     helpers below take an index and apply `marginTop` from it.
 *   - No external stylesheet. Every style is an inline object, which is why `tokens.ts` exists as
 *     TS constants rather than being read from globals.css.
 *
 * OMISSION IS BUILT IN. Every primitive returns `null` when its data is absent, so a template can
 * compose unconditionally and simply get nothing where there is nothing. That is what makes "omit
 * rather than fabricate" the path of least resistance rather than a discipline someone has to
 * remember — and `null` children are dropped by satori without leaving a gap.
 *
 * PROVENANCE IS RECORDED AT DRAW TIME. Primitives that render a number take the `ManifestRecorder`
 * and report what they drew. The manifest therefore describes the IMAGE, not the input.
 */

import type { ReactElement } from "react";
import { C, FONT, GLYPH, levelColor, stanceColor, toneColor } from "./tokens";
import type { SizeSpec } from "./sizes";
import { s } from "./sizes";
import type { ManifestRecorder } from "./manifest";
import type {
  VisualLevel,
  VisualMetric,
  VisualNumber,
  VisualSystemRead,
  VisualTimelineStep,
} from "./types";

/** Uppercase mono label — the desk's kicker vocabulary. */
export function Kicker({ text, spec, color = C.faint }: { text: string; spec: SizeSpec; color?: string }): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        fontFamily: FONT.mono,
        fontSize: s(15, spec),
        letterSpacing: s(3, spec),
        textTransform: "uppercase",
        color,
      }}
    >
      {text}
    </div>
  );
}

/**
 * CARD CHROME — the top strip.
 *
 * The purple mark is the Largo provenance signal and it appears here and on the left rule and
 * nowhere else, per the repo's own note that purple marks synthesis BOUNDARIES rather than being
 * a theme. The systems list beside it is what the card actually consulted, so a reader can tell a
 * measurement from an interpretation before reading a word.
 */
export function CardHeader({
  systems,
  asOfLabel,
  freshness,
  spec,
}: {
  systems: string[];
  asOfLabel: string | null;
  freshness?: string;
  spec: SizeSpec;
}): ReactElement {
  const live = freshness === "live";
  return (
    <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
      <div
        style={{
          display: "flex",
          fontFamily: FONT.mono,
          fontSize: s(15, spec),
          letterSpacing: s(3, spec),
          color: C.ai,
          fontWeight: 700,
        }}
      >
        LARGO
      </div>
      {systems.length > 0 && (
        <div
          style={{
            display: "flex",
            fontFamily: FONT.mono,
            fontSize: s(15, spec),
            letterSpacing: s(3, spec),
            color: C.faint,
            marginLeft: s(14, spec),
          }}
        >
          {`/ ${systems.join(" · ")}`}
        </div>
      )}
      <div style={{ display: "flex", marginLeft: "auto", alignItems: "center" }}>
        {live && (
          <div
            style={{
              display: "flex",
              width: s(9, spec),
              height: s(9, spec),
              borderRadius: s(5, spec),
              background: C.bull,
              marginRight: s(8, spec),
            }}
          />
        )}
        {asOfLabel && (
          <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(15, spec), color: live ? C.bull : C.faint }}>
            {asOfLabel}
          </div>
        )}
      </div>
    </div>
  );
}

/** Brand footer + the educational disclaimer the brief requires on every asset. */
export function CardFooter({ attribution, spec }: { attribution: string | null; spec: SizeSpec }): ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      <div style={{ display: "flex", width: "100%", height: 1, background: C.rule, marginBottom: s(16, spec) }} />
      <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
        <div style={{ display: "flex", fontFamily: FONT.display, fontSize: s(26, spec), color: C.brand, letterSpacing: s(1, spec) }}>
          BLACKOUT
        </div>
        {attribution && (
          <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(14, spec), color: C.faint, marginLeft: s(16, spec) }}>
            {attribution}
          </div>
        )}
        <div style={{ display: "flex", marginLeft: "auto", fontFamily: FONT.mono, fontSize: s(13, spec), color: C.faint }}>
          blackouttrades.com
        </div>
      </div>
      {/* Not decoration. A market graphic that travels without context needs this attached to it. */}
      <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(12, spec), color: "rgba(148,163,184,0.42)", marginTop: s(10, spec) }}>
        Educational market data · not financial advice · past results do not predict future returns
      </div>
    </div>
  );
}

/** The card's single conclusion. Uses the display face at the largest size on the card. */
export function Headline({ text, spec, color = C.primary }: { text: string; spec: SizeSpec; color?: string }): ReactElement {
  // Long verdicts get a step down rather than wrapping to three lines and crowding the evidence.
  const size = text.length > 46 ? s(52, spec) : text.length > 30 ? s(64, spec) : s(78, spec);
  return (
    <div style={{ display: "flex", fontFamily: FONT.display, fontSize: size, color, lineHeight: 1.02, letterSpacing: s(1, spec) }}>
      {text}
    </div>
  );
}

/** The hero number — spot, return, whatever the card is centrally about. */
export function HeroNumber({
  n,
  label,
  spec,
  recorder,
  color = C.primary,
}: {
  n: VisualNumber | null | undefined;
  label: string;
  spec: SizeSpec;
  recorder: ManifestRecorder;
  color?: string;
}): ReactElement | null {
  if (!n) {
    recorder.omit(label);
    return null;
  }
  recorder.value(label, n.display, n.source, n.asOf);
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <Kicker text={label} spec={spec} />
      {/* 92px is the tall-surface size. On a 630px landscape it is ~15% of the canvas height for
          one number, and it was pushing the supporting evidence off the bottom — the hero was
          winning space from the rows that justify it. */}
      <div style={{ display: "flex", fontFamily: FONT.display, fontSize: s(spec.dense ? 74 : 92, spec), color, lineHeight: 1, marginTop: s(6, spec) }}>
        {n.display}
      </div>
    </div>
  );
}

/** A metric tile. */
export function MetricTile({ m, spec, recorder }: { m: VisualMetric; spec: SizeSpec; recorder: ManifestRecorder }): ReactElement {
  recorder.value(m.label, m.value, m.source);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        padding: s(16, spec),
        background: "rgba(255,255,255,0.02)",
        borderLeft: `${s(3, spec)}px solid ${toneColor(m.tone)}`,
      }}
    >
      <Kicker text={m.label} spec={spec} />
      <div
        style={{
          display: "flex",
          fontFamily: FONT.mono,
          fontWeight: 700,
          fontSize: s(34, spec),
          color: toneColor(m.tone),
          marginTop: s(8, spec),
        }}
      >
        {m.value}
      </div>
      {m.sub && (
        <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(14, spec), color: C.faint, marginTop: s(6, spec) }}>
          {m.sub}
        </div>
      )}
    </div>
  );
}

/** A row of metric tiles. Returns null when there are none — no empty rail. */
export function MetricRow({
  metrics,
  spec,
  recorder,
  max = 4,
}: {
  metrics: VisualMetric[] | undefined;
  spec: SizeSpec;
  recorder: ManifestRecorder;
  max?: number;
}): ReactElement | null {
  const rows = (metrics ?? []).slice(0, max);
  if (!rows.length) {
    recorder.omit("metrics");
    return null;
  }
  return (
    <div style={{ display: "flex", width: "100%" }}>
      {rows.map((m, i) => (
        <div key={m.label} style={{ display: "flex", flex: 1, marginLeft: i === 0 ? 0 : s(14, spec) }}>
          <MetricTile m={m} spec={spec} recorder={recorder} />
        </div>
      ))}
    </div>
  );
}

/**
 * LEVEL MAP — levels sorted price-descending with SPOT inserted in its true position.
 *
 * Inserting spot as a row (rather than drawing it separately) is what makes the map impossible to
 * misread: a level above spot is physically above it on the card. The same reasoning as the
 * terminal's own ladder, which builds a synthetic spot row for exactly this reason.
 */
export function LevelMap({
  levels,
  spot,
  spec,
  recorder,
  max = 6,
}: {
  levels: VisualLevel[] | undefined;
  spot: VisualNumber | null | undefined;
  spec: SizeSpec;
  recorder: ManifestRecorder;
  max?: number;
}): ReactElement | null {
  const rows = [...(levels ?? [])];
  if (!rows.length) {
    recorder.omit("level map");
    return null;
  }

  type Row = { label: string; display: string; kind: string; distance?: string | null; status?: string | null; isSpot: boolean };
  const mapped: Row[] = rows.map((l) => ({
    label: l.label,
    display: l.display,
    kind: l.kind,
    distance: l.distance,
    status: l.status,
    isSpot: false,
  }));

  const all: { price: number; row: Row }[] = rows.map((l, i) => ({ price: l.price, row: mapped[i]! }));
  if (spot) {
    all.push({ price: spot.value, row: { label: "SPOT", display: spot.display, kind: "spot", isSpot: true } });
  }
  // Descending, and a tie puts spot LAST so a level at exactly spot reads as the level price
  // has been reached rather than as spot having overtaken it.
  all.sort((a, b) => (b.price - a.price) || (a.row.isSpot ? 1 : -1));

  const shown = all.slice(0, max + (spot ? 1 : 0));
  for (const { row } of shown) {
    if (!row.isSpot) recorder.value(row.label, row.display, rows.find((l) => l.label === row.label)?.source ?? "THERMAL");
  }
  if (spot) recorder.value("Spot", spot.display, spot.source, spot.asOf);

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      {shown.map(({ row }, i) => {
        const color = levelColor(row.kind);
        return (
          <div
            key={`${row.label}-${i}`}
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              padding: `${s(11, spec)}px ${s(14, spec)}px`,
              marginTop: i === 0 ? 0 : s(7, spec),
              background: row.isSpot ? "rgba(34,211,238,0.08)" : "rgba(255,255,255,0.015)",
              borderLeft: `${s(3, spec)}px solid ${color}`,
            }}
          >
            {/* THE "CALL WALl" BUG — an explicit column width, not a shrink-to-fit box.
                Every landscape card rendered the walls with the final letter sliced vertically.
                Diagnosed by elimination: `flexShrink: 0` did not fix it, `paddingRight` did not
                change a single byte of the output, and removing `letterSpacing` made it WORSE
                (it spread to "PUT WALL" too). The pattern that survived: only labels ending in a
                glyph whose ink reaches the right edge of its advance box clip — `L` does, `P`
                ("GAMMA FLIP") and `T` ("SPOT") do not. So satori sizes the shrink-to-fit text box
                a sub-pixel short and paints the last glyph across the boundary.
                A fixed width removes the shrink-to-fit measurement entirely, and it aligns the
                label column as a side effect — the same thing the leaderboard rows do, which is
                why they never showed this. A label longer than the column is a data problem, and
                one this set (wall / flip / spot / pivot) does not have. */}
            <div
              style={{
                display: "flex",
                width: s(220, spec),
                flexShrink: 0,
                whiteSpace: "nowrap",
                fontFamily: FONT.mono,
                fontSize: s(18, spec),
                letterSpacing: s(2, spec),
                textTransform: "uppercase",
                color: row.isSpot ? C.info : color,
                fontWeight: row.isSpot ? 700 : 400,
              }}
            >
              {row.label}
            </div>
            <div style={{ display: "flex", marginLeft: "auto", alignItems: "center" }}>
              {row.status && (
                <div
                  style={{
                    display: "flex",
                    fontFamily: FONT.mono,
                    fontSize: s(14, spec),
                    letterSpacing: s(2, spec),
                    textTransform: "uppercase",
                    color: row.status === "held" ? C.bull : row.status === "broke" ? C.bear : C.faint,
                    marginRight: s(16, spec),
                  }}
                >
                  {row.status}
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  fontFamily: FONT.mono,
                  fontWeight: 700,
                  fontSize: s(row.isSpot ? 30 : 26, spec),
                  color: row.isSpot ? C.primary : color,
                }}
              >
                {row.display}
              </div>
              {row.distance && (
                <div
                  style={{
                    display: "flex",
                    fontFamily: FONT.mono,
                    fontSize: s(16, spec),
                    color: C.faint,
                    marginLeft: s(14, spec),
                    width: s(84, spec),
                    justifyContent: "flex-end",
                  }}
                >
                  {row.distance}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Lifecycle timeline. Every step carries a real timestamp — steps without one never reach here
 *  (see `timelineFromLedgerRow`), which is why there is no placeholder branch. */
export function Timeline({
  steps,
  spec,
  recorder,
}: {
  steps: VisualTimelineStep[] | undefined;
  spec: SizeSpec;
  recorder: ManifestRecorder;
}): ReactElement | null {
  const rows = steps ?? [];
  if (!rows.length) {
    recorder.omit("timeline");
    return null;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      {rows.map((step, i) => {
        const color =
          step.tone === "positive" ? C.bull : step.tone === "negative" ? C.bear : step.tone === "caution" ? C.warn : C.info;
        recorder.value(`${step.label} @`, step.time, "NIGHT HAWK");
        return (
          <div key={`${step.label}-${i}`} style={{ display: "flex", width: "100%", marginTop: i === 0 ? 0 : s(4, spec) }}>
            {/* Rail: dot + connector. The connector is omitted on the last row so the line ends
                at the final event rather than trailing into nothing. */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: s(26, spec) }}>
              <div style={{ display: "flex", width: s(11, spec), height: s(11, spec), borderRadius: s(6, spec), background: color, marginTop: s(7, spec) }} />
              {i < rows.length - 1 && (
                <div style={{ display: "flex", width: 2, flex: 1, background: C.rule, marginTop: s(3, spec) }} />
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", flex: 1, paddingBottom: s(14, spec), marginLeft: s(12, spec) }}>
              <div style={{ display: "flex", alignItems: "baseline" }}>
                <div
                  style={{
                    display: "flex",
                    fontFamily: FONT.mono,
                    fontSize: s(19, spec),
                    letterSpacing: s(2, spec),
                    textTransform: "uppercase",
                    color: C.primary,
                    fontWeight: 700,
                  }}
                >
                  {step.label}
                </div>
                <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(19, spec), color, marginLeft: s(14, spec) }}>
                  {step.time}
                </div>
              </div>
              {step.detail && (
                <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(15, spec), color: C.muted, marginTop: s(4, spec) }}>
                  {step.detail}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** System attribution strip — which product said what. */
export function SystemStrip({
  reads,
  spec,
  recorder,
}: {
  reads: VisualSystemRead[] | undefined;
  spec: SizeSpec;
  recorder: ManifestRecorder;
}): ReactElement | null {
  const rows = reads ?? [];
  if (!rows.length) {
    recorder.omit("system attribution");
    return null;
  }
  return (
    <div style={{ display: "flex", width: "100%" }}>
      {rows.slice(0, 4).map((r, i) => {
        const color = stanceColor(r.stance);
        const glyph =
          r.stance === "bullish" ? GLYPH.up : r.stance === "bearish" ? GLYPH.down : r.stance === "regime" ? GLYPH.regime : GLYPH.none;
        if (r.detail) recorder.value(`${r.system} read`, r.detail, r.system);
        return (
          <div
            key={r.system}
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              marginLeft: i === 0 ? 0 : s(12, spec),
              paddingTop: s(12, spec),
              borderTop: `${s(2, spec)}px solid ${color}`,
            }}
          >
            <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(13, spec), letterSpacing: s(2, spec), color: C.faint }}>
              {r.system}
            </div>
            <div style={{ display: "flex", alignItems: "center", marginTop: s(5, spec) }}>
              <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(15, spec), color }}>{glyph}</div>
              <div
                style={{
                  display: "flex",
                  fontFamily: FONT.mono,
                  fontWeight: 700,
                  fontSize: s(17, spec),
                  letterSpacing: s(1, spec),
                  textTransform: "uppercase",
                  color,
                  marginLeft: s(7, spec),
                }}
              >
                {r.stance === "no-read" ? "NO READ" : r.stance}
              </div>
            </div>
            {r.detail && (
              <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(14, spec), color: C.muted, marginTop: s(4, spec) }}>
                {r.detail}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** GEX shift bars — strike-level dealer-gamma change. Direction comes from the tool, never from
 *  the sign, because `flipped` is a third state a sign test cannot express. */
export function GexBars({
  shifts,
  spec,
  recorder,
  max = 4,
}: {
  shifts: { strike: number; change: number; display: string; direction: string }[] | undefined;
  spec: SizeSpec;
  recorder: ManifestRecorder;
  max?: number;
}): ReactElement | null {
  const rows = (shifts ?? []).slice(0, max);
  if (!rows.length) {
    recorder.omit("gex shifts");
    return null;
  }
  const peak = Math.max(...rows.map((r) => Math.abs(r.change)), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      {rows.map((r, i) => {
        const color = r.direction === "flipped" ? C.warn : r.change > 0 ? C.bull : C.bear;
        recorder.value(`${r.strike} Δγ`, r.display, "THERMAL");
        return (
          <div key={r.strike} style={{ display: "flex", alignItems: "center", width: "100%", marginTop: i === 0 ? 0 : s(9, spec) }}>
            <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(20, spec), color: C.primary, width: s(96, spec) }}>
              {r.strike.toLocaleString("en-US")}
            </div>
            <div style={{ display: "flex", flex: 1, height: s(16, spec), background: "rgba(255,255,255,0.03)", marginLeft: s(10, spec) }}>
              <div style={{ display: "flex", width: `${Math.max(4, (Math.abs(r.change) / peak) * 100)}%`, height: "100%", background: color }} />
            </div>
            <div
              style={{
                display: "flex",
                fontFamily: FONT.mono,
                fontWeight: 700,
                fontSize: s(19, spec),
                color,
                marginLeft: s(14, spec),
                width: s(120, spec),
                justifyContent: "flex-end",
              }}
            >
              {r.display}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** P&L block. Labels itself LIVE vs BOOKED from the row's grading state — an ungraded position is
 *  never presented as a result. */
export function PnlBlock({
  returnPct,
  graded,
  spec,
  recorder,
}: {
  returnPct: VisualNumber | null | undefined;
  graded: boolean | undefined;
  spec: SizeSpec;
  recorder: ManifestRecorder;
}): ReactElement | null {
  if (!returnPct) {
    recorder.omit("p&l");
    return null;
  }
  const positive = returnPct.value >= 0;
  const label = graded ? "Booked return" : "Live mark-to-market";
  recorder.value(label, returnPct.display, returnPct.source, returnPct.asOf);
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <Kicker text={label} spec={spec} color={graded ? C.faint : C.warn} />
      <div
        style={{
          display: "flex",
          fontFamily: FONT.display,
          fontSize: s(88, spec),
          color: positive ? C.bull : C.bear,
          lineHeight: 1,
          marginTop: s(6, spec),
        }}
      >
        {returnPct.display}
      </div>
      {!graded && (
        <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(14, spec), color: C.warn, marginTop: s(8, spec) }}>
          Position open · not a booked result
        </div>
      )}
    </div>
  );
}

/**
 * The card shell every template renders into.
 *
 * THE FOOTER IS PINNED, AND THAT IS A CORRECTNESS DECISION, NOT A LAYOUT ONE.
 *
 * The first landscape renders overflowed the 630px canvas and the block that fell off the bottom
 * was the footer — carrying the brand mark, the attribution and the mandatory educational
 * disclaimer with it. A card that silently sheds its disclaimer because a headline ran long is a
 * compliance problem produced by a layout bug, and no amount of type-scale tuning makes that
 * failure mode impossible.
 *
 * So the footer is absolutely positioned at the bottom and the content region is explicitly
 * bounded above it with `overflow: hidden`. If a template still overflows, it now loses a row of
 * EVIDENCE — recoverable, visible, and the right thing to lose — instead of losing the disclaimer.
 */
export function CardShell({
  spec,
  footer,
  children,
}: {
  spec: SizeSpec;
  footer: ReactElement;
  children: ReactElement[] | ReactElement;
}): ReactElement {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: C.void,
        position: "relative",
        // The Largo provenance rule: purple marks the synthesis boundary and nothing inside it.
        borderLeft: `${Math.round(spec.pad / 8)}px solid ${C.ai}`,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: spec.height - spec.footer,
          padding: spec.pad,
          paddingBottom: 0,
          overflow: "hidden",
        }}
      >
        {children}
      </div>
      <div
        style={{
          display: "flex",
          position: "absolute",
          bottom: 0,
          left: 0,
          width: "100%",
          padding: `0 ${spec.pad}px ${Math.round(spec.pad * 0.55)}px`,
        }}
      >
        {footer}
      </div>
    </div>
  );
}
