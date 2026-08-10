"use client";

import { clsx } from "clsx";
import type { LargoBlock, LargoSource, LargoTone } from "./schema";

/**
 * BLACKOUT-native renderers for Largo's semantic components.
 *
 * One component per block type. Every one is presentational and total: it renders whatever the
 * (already-validated) block carries and never fetches, never computes a market number, and never
 * invents a value to fill a gap. The schema has already rejected structurally empty blocks, so
 * nothing here has to defend against "render an empty table".
 *
 * MOBILE IS NOT AN AFTERTHOUGHT. The desk is used on a phone. Anything grid-shaped either reflows
 * to stacked rows (comparison, pnl, contracts) or scrolls inside its own container (table) — the
 * page body must never scroll sideways. That is why `comparison` is NOT a <table>: a real table
 * cannot reflow, and a 4-column signal matrix on a 390px screen is unreadable however it is styled.
 */

function toneClass(tone: LargoTone | undefined, prefix = "lb-tone"): string | undefined {
  return tone ? `${prefix}--${tone}` : undefined;
}

const TONE_DOT: Record<LargoTone, string> = {
  bullish: "●",
  bearish: "●",
  neutral: "○",
  warning: "▲",
  info: "◆",
};

function Source({ source }: { source?: LargoSource }) {
  if (!source) return null;
  // Freshness is rendered even when unknown. Silently omitting it would let a stale number look
  // exactly like a live one, which is the failure the whole honesty spine exists to prevent.
  const f = source.freshness ?? "unknown";
  return (
    <span className={clsx("lb-src", `lb-src--${f}`)}>
      {source.label}
      {source.asOf ? ` · ${source.asOf}` : ""}
      {` · ${f}`}
    </span>
  );
}

function Header({ b }: { b: Extract<LargoBlock, { type: "header" }> }) {
  const c = b.confidence;
  return (
    <div className={clsx("lb-header", toneClass(b.tone))}>
      <div className="lb-header-top">
        <h3 className="lb-header-title">{b.title}</h3>
        {b.badge ? <span className={clsx("lb-badge", toneClass(b.tone, "lb-badge"))}>{b.badge}</span> : null}
        {c ? (
          <span className={clsx("lb-conf", `lb-conf--${c.level}`)}>
            {c.pct != null ? `${Math.round(c.pct)}% ` : ""}
            {c.level}
          </span>
        ) : null}
      </div>
      {b.subtitle ? <p className="lb-header-sub">{b.subtitle}</p> : null}
      {c?.why ? <p className="lb-header-why">{c.why}</p> : null}
    </div>
  );
}

function Metrics({ b }: { b: Extract<LargoBlock, { type: "metrics" }> }) {
  return (
    <div className="lb-block">
      {b.title ? <div className="lb-block-title">{b.title}</div> : null}
      <div className="lb-metrics">
        {b.items.map((m, i) => (
          <div key={`${m.label}-${i}`} className={clsx("lb-metric", toneClass(m.tone))}>
            <div className="lb-metric-label">{m.label}</div>
            <div className="lb-metric-value">{m.value}</div>
            {m.delta ? <div className="lb-metric-delta">{m.delta}</div> : null}
            {m.note ? <div className="lb-metric-note">{m.note}</div> : null}
            <Source source={m.source} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Comparison({ b }: { b: Extract<LargoBlock, { type: "comparison" }> }) {
  const cols = b.columns ?? ["Signal", "Reading", "Bias"];
  return (
    <div className="lb-block">
      {b.title ? <div className="lb-block-title">{b.title}</div> : null}
      {/* Deliberately a grid of rows, not a <table>: a table cannot reflow, and this is the most
          likely component to be read on a phone. On narrow screens each row stacks. */}
      <div className="lb-cmp" role="table" aria-label={b.title ?? "Signal comparison"}>
        <div className="lb-cmp-head" role="row">
          {cols.map((c) => (
            <span key={c} role="columnheader">
              {c}
            </span>
          ))}
        </div>
        {b.rows.map((r, i) => (
          <div key={`${r.label}-${i}`} className={clsx("lb-cmp-row", toneClass(r.tone))} role="row">
            <span className="lb-cmp-label" role="cell">
              {r.label}
            </span>
            <span className="lb-cmp-reading" role="cell">
              {r.reading}
              {r.note ? <em className="lb-cmp-note">{r.note}</em> : null}
              <Source source={r.source} />
            </span>
            <span className="lb-cmp-bias" role="cell">
              {r.tone ? (
                <>
                  <span aria-hidden="true">{TONE_DOT[r.tone]}</span> {r.tone}
                </>
              ) : (
                "—"
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Table({ b }: { b: Extract<LargoBlock, { type: "table" }> }) {
  const numeric = new Set(b.numericColumns ?? []);
  return (
    <div className="lb-block">
      {b.title ? <div className="lb-block-title">{b.title}</div> : null}
      {/* Wide tables scroll INSIDE this wrapper — the page body must never scroll horizontally. */}
      <div className="lb-table-scroll">
        <table className="lb-table">
          <thead>
            <tr>
              {b.columns.map((c, i) => (
                <th key={c} className={numeric.has(i) ? "lb-num" : undefined}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} className={numeric.has(ci) ? "lb-num" : undefined}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Source source={b.source} />
    </div>
  );
}

function Ranked({ b }: { b: Extract<LargoBlock, { type: "ranked" }> }) {
  return (
    <div className="lb-block">
      {b.title ? <div className="lb-block-title">{b.title}</div> : null}
      <ol className="lb-ranked">
        {b.items.map((it, i) => (
          <li key={`${it.label}-${i}`} className={clsx("lb-ranked-item", toneClass(it.tone))}>
            <span className="lb-ranked-n">{i + 1}</span>
            <span className="lb-ranked-label">{it.label}</span>
            {it.value ? <span className="lb-ranked-value">{it.value}</span> : null}
            {it.note ? <span className="lb-ranked-note">{it.note}</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Levels({ b }: { b: Extract<LargoBlock, { type: "levels" }> }) {
  // Sorted high → low so the rail reads like a price ladder rather than emission order.
  const items = [...b.items].sort((x, y) => y.price - x.price);
  return (
    <div className="lb-block">
      {b.title ? <div className="lb-block-title">{b.title}</div> : null}
      <div className="lb-levels">
        {items.map((l, i) => {
          // Above/below spot is a fact worth showing, but ONLY when spot is known. Guessing it
          // from the level list would invent a relationship the data does not carry.
          const side = b.spot == null ? null : l.price >= b.spot ? "above" : "below";
          return (
            <div key={`${l.label}-${i}`} className={clsx("lb-level", l.kind && `lb-level--${l.kind}`, side && `lb-level--${side}`)}>
              <span className="lb-level-price">{l.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              <span className="lb-level-label">{l.label}</span>
              {l.kind ? <span className="lb-level-kind">{l.kind}</span> : null}
              {l.note ? <span className="lb-level-note">{l.note}</span> : null}
              <Source source={l.source} />
            </div>
          );
        })}
        {b.spot != null ? <div className="lb-level lb-level--spot"><span className="lb-level-price">{b.spot.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span><span className="lb-level-label">spot</span></div> : null}
      </div>
    </div>
  );
}

function Evidence({ b }: { b: Extract<LargoBlock, { type: "evidence" }> }) {
  return (
    <div className="lb-block">
      {b.title ? <div className="lb-block-title">{b.title}</div> : null}
      <div className="lb-evidence">
        <div className="lb-evidence-col lb-evidence-col--bull">
          <div className="lb-evidence-head">Bull</div>
          {b.bull.length ? (
            <ul>{b.bull.map((x, i) => <li key={i}>{x}</li>)}</ul>
          ) : (
            // Saying "nothing on this side" beats an empty column, which reads as a render bug.
            <p className="lb-evidence-empty">Nothing on this side.</p>
          )}
        </div>
        <div className="lb-evidence-col lb-evidence-col--bear">
          <div className="lb-evidence-head">Bear</div>
          {b.bear.length ? (
            <ul>{b.bear.map((x, i) => <li key={i}>{x}</li>)}</ul>
          ) : (
            <p className="lb-evidence-empty">Nothing on this side.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Timeline({ b }: { b: Extract<LargoBlock, { type: "timeline" }> }) {
  return (
    <div className="lb-block">
      {b.title ? <div className="lb-block-title">{b.title}</div> : null}
      <ol className="lb-timeline">
        {b.items.map((it, i) => (
          <li key={`${it.at}-${i}`} className={clsx("lb-tl-item", toneClass(it.tone))}>
            <span className="lb-tl-at">{it.at}</span>
            <span className="lb-tl-label">{it.label}</span>
            {it.note ? <span className="lb-tl-note">{it.note}</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Contracts({ b }: { b: Extract<LargoBlock, { type: "contracts" }> }) {
  return (
    <div className="lb-block">
      {b.title ? <div className="lb-block-title">{b.title}</div> : null}
      <div className="lb-contracts">
        {b.items.map((c, i) => (
          <div key={`${c.ticker}-${c.strike}-${i}`} className={clsx("lb-contract", toneClass(c.tone))}>
            <div className="lb-contract-head">
              <span className="lb-contract-ticker">{c.ticker}</span>
              <span className={clsx("lb-contract-right", c.right === "C" ? "lb-contract-right--c" : "lb-contract-right--p")}>
                {c.right === "C" ? "CALL" : "PUT"}
              </span>
              <span className="lb-contract-strike">{c.strike}</span>
              <span className="lb-contract-exp">{c.expiry}</span>
            </div>
            <div className="lb-contract-greeks">
              {c.mark ? <span>mark {c.mark}</span> : null}
              {c.delta ? <span>Δ {c.delta}</span> : null}
              {c.iv ? <span>IV {c.iv}</span> : null}
              {c.oi ? <span>OI {c.oi}</span> : null}
            </div>
            {c.note ? <div className="lb-contract-note">{c.note}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function Pnl({ b }: { b: Extract<LargoBlock, { type: "pnl" }> }) {
  return (
    <div className="lb-block">
      {b.title ? <div className="lb-block-title">{b.title}</div> : null}
      <div className="lb-pnl">
        {b.items.map((p, i) => (
          <div key={`${p.label}-${i}`} className={clsx("lb-pnl-row", toneClass(p.tone))}>
            <span className="lb-pnl-label">{p.label}</span>
            {p.entry ? <span className="lb-pnl-cell">in {p.entry}</span> : null}
            {p.current ? <span className="lb-pnl-cell">now {p.current}</span> : null}
            <span className="lb-pnl-value">{p.pnl}</span>
            {p.pct ? <span className="lb-pnl-pct">{p.pct}</span> : null}
          </div>
        ))}
        {b.total ? (
          <div className={clsx("lb-pnl-row lb-pnl-row--total", toneClass(b.total.tone))}>
            <span className="lb-pnl-label">Total</span>
            <span className="lb-pnl-value">{b.total.pnl}</span>
            {b.total.pct ? <span className="lb-pnl-pct">{b.total.pct}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Callout({ b }: { b: Extract<LargoBlock, { type: "callout" }> }) {
  return (
    <div className={clsx("lb-callout", toneClass(b.tone))}>
      {b.title ? <div className="lb-callout-title">{b.title}</div> : null}
      <p className="lb-callout-body">{b.body}</p>
    </div>
  );
}

function Risk({ b }: { b: Extract<LargoBlock, { type: "risk" }> }) {
  return (
    <div className="lb-risk">
      <div className="lb-risk-title">{b.title ?? "Risk"}</div>
      {b.items.length ? (
        <ul className="lb-risk-list">{b.items.map((x, i) => <li key={i}>{x}</li>)}</ul>
      ) : null}
      {b.invalidation ? (
        <div className="lb-risk-inval">
          <span className="lb-risk-inval-label">Invalidation</span>
          {b.invalidation}
        </div>
      ) : null}
    </div>
  );
}

/** Render one validated block. Exhaustive over the union — a new type fails the build here. */
export function LargoBlockView({ block }: { block: LargoBlock }) {
  switch (block.type) {
    case "header":
      return <Header b={block} />;
    case "metrics":
      return <Metrics b={block} />;
    case "comparison":
      return <Comparison b={block} />;
    case "table":
      return <Table b={block} />;
    case "ranked":
      return <Ranked b={block} />;
    case "levels":
      return <Levels b={block} />;
    case "evidence":
      return <Evidence b={block} />;
    case "timeline":
      return <Timeline b={block} />;
    case "contracts":
      return <Contracts b={block} />;
    case "pnl":
      return <Pnl b={block} />;
    case "callout":
      return <Callout b={block} />;
    case "risk":
      return <Risk b={block} />;
  }
}

/** Skeleton shown while a fence is open mid-stream — see extract.ts's `pending` segment. */
export function LargoBlockPending() {
  return (
    <div className="lb-pending" aria-label="Building component" role="status">
      <span />
      <span />
      <span />
    </div>
  );
}
