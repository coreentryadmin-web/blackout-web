"use client";

/**
 * CREATE VISUAL — the action on every Largo answer.
 *
 * PREVIEW FIRST, ALWAYS. Clicking opens a panel that describes what WOULD be drawn — template,
 * snapshot instant, and the actual values the card will assert — without encoding an image or
 * touching a download. That is the brief's explicit requirement, and it is also the control that
 * makes the whole feature safe: a member (or an admin composing a post) sees the claims before
 * the asset exists, rather than after it is already on their clipboard.
 *
 * THE EVIDENCE IS THE TURN'S OWN. `capturedResults` is passed straight through from the answer
 * that is already on screen. This component never fetches market data, so the graphic cannot
 * disagree with the words above it.
 *
 * "CANNOT DRAW" IS A REAL OUTCOME and gets its own state. When the router finds no template the
 * evidence can honestly fill, the panel says so and names what was missing — it does not fall
 * back to a thin card.
 */

import { useCallback, useState } from "react";

type TemplateChoice = "AUTO" | "MARKET_MOVE" | "TRADE_RECAP" | "LEVEL_ANALYSIS";
type SizeChoice = "x_landscape" | "x_portrait" | "square" | "story";
type FormatChoice = "html" | "svg" | "png";

const TEMPLATE_LABELS: { id: TemplateChoice; label: string }[] = [
  { id: "AUTO", label: "Auto" },
  { id: "MARKET_MOVE", label: "Market Card" },
  { id: "TRADE_RECAP", label: "Trade Recap" },
  { id: "LEVEL_ANALYSIS", label: "Level Map" },
];

/** Inline is the default: the card appears in the answer, nothing is downloaded. */
const FORMAT_LABELS: { id: FormatChoice; label: string }[] = [
  { id: "html", label: "Inline" },
  { id: "svg", label: "SVG" },
  { id: "png", label: "PNG" },
];

const SIZE_LABELS: { id: SizeChoice; label: string }[] = [
  { id: "x_landscape", label: "X Landscape" },
  { id: "x_portrait", label: "X Portrait" },
  { id: "square", label: "Square" },
  { id: "story", label: "Story" },
];

type Plan = {
  renderable: boolean;
  reason?: string;
  detail?: string;
  template?: string;
  matchedIntent?: boolean;
  rejected?: { template: string; needs: string }[];
  dimensions?: { width: number; height: number };
  dataAsOf?: string;
  freshness?: string;
  systemsQueried?: string[];
  preview?: {
    headline: string | null;
    spot: string | null;
    levels: { label: string; value: string }[];
    metrics: { label: string; value: string }[];
    trade: { ticker: string; graded?: boolean; return: string | null } | null;
  };
};

export type CreateVisualActionProps = {
  question: string;
  headline?: string | null;
  summary?: string | null;
  bias?: "bull" | "bear" | "neutral" | null;
  ticker?: string | null;
  /** The SAME tool results the answer was written from. */
  capturedResults?: unknown[];
  envelopeLevels?: { label: string; value: number | string }[] | null;
  ledgerRow?: Record<string, unknown> | null;
};

export function CreateVisualAction(props: CreateVisualActionProps) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [template, setTemplate] = useState<TemplateChoice>("AUTO");
  const [size, setSize] = useState<SizeChoice>("x_landscape");
  const [format, setFormat] = useState<FormatChoice>("html");
  const [markup, setMarkup] = useState<{ html: string; svg: string | null } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const body = useCallback(
    () => ({
      question: props.question,
      headline: props.headline ?? null,
      summary: props.summary ?? null,
      bias: props.bias ?? null,
      ticker: props.ticker ?? null,
      capturedResults: props.capturedResults ?? [],
      envelopeLevels: props.envelopeLevels ?? null,
      ledgerRow: props.ledgerRow ?? null,
      template,
      size,
      format,
    }),
    [props, template, size, format]
  );

  /** Ask what WOULD be drawn. No image is encoded by this call. */
  const loadPlan = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/largo/visual?plan=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body()),
      });
      if (!res.ok) throw new Error(`Preview failed (${res.status})`);
      setPlan((await res.json()) as Plan);
      // A changed template/size invalidates anything already rendered from the previous choice.
      setImgUrl(null);
      setMarkup(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }, [body]);

  const onOpen = useCallback(() => {
    setOpen(true);
    void loadPlan();
  }, [loadPlan]);

  /** Only this button produces output. Inline/SVG return markup; PNG returns bytes. */
  const render = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/largo/visual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body()),
      });
      if (!res.ok) throw new Error(`Render failed (${res.status})`);

      if (format === "png") {
        const blob = await res.blob();
        setMarkup(null);
        setImgUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
      } else {
        const json = (await res.json()) as { html?: string; svg?: string | null; renderable?: boolean; detail?: string };
        if (!json.renderable || !json.html) throw new Error(json.detail ?? "Nothing to render");
        setImgUrl(null);
        setMarkup({ html: json.html, svg: json.svg ?? null });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Render failed");
    } finally {
      setBusy(false);
    }
  }, [body, format]);

  const copy = useCallback(async (what: "svg" | "html") => {
    const text = what === "svg" ? markup?.svg : markup?.html;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setError("Clipboard unavailable — select the markup manually.");
    }
  }, [markup]);

  const choose = useCallback(
    (next: Partial<{ template: TemplateChoice; size: SizeChoice; format: FormatChoice }>) => {
      if (next.template) setTemplate(next.template);
      if (next.size) setSize(next.size);
      if (next.format) setFormat(next.format);
      setImgUrl(null);
      setMarkup(null);
    },
    []
  );

  if (!open) {
    return (
      <button type="button" onClick={onOpen} className="largo-visual-trigger">
        Create visual
      </button>
    );
  }

  return (
    <div className="largo-visual-panel" role="group" aria-label="Create visual">
      <div className="largo-visual-row">
        {TEMPLATE_LABELS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={template === t.id}
            className={`largo-visual-chip${template === t.id ? " is-on" : ""}`}
            onClick={() => choose({ template: t.id })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="largo-visual-row">
        {SIZE_LABELS.map((sz) => (
          <button
            key={sz.id}
            type="button"
            aria-pressed={size === sz.id}
            className={`largo-visual-chip${size === sz.id ? " is-on" : ""}`}
            onClick={() => choose({ size: sz.id })}
          >
            {sz.label}
          </button>
        ))}
      </div>

      <div className="largo-visual-row">
        {FORMAT_LABELS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={format === f.id}
            className={`largo-visual-chip${format === f.id ? " is-on" : ""}`}
            onClick={() => choose({ format: f.id })}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <p className="largo-visual-error">{error}</p>}

      {/* Refusing to draw is a first-class outcome, with its reason named. */}
      {plan && !plan.renderable && (
        <div className="largo-visual-blocked">
          <strong>No visual for this answer.</strong>
          <span>{plan.detail ?? "There is not enough evidence to draw one without inventing data."}</span>
        </div>
      )}

      {plan?.renderable && (
        <div className="largo-visual-plan">
          <div className="largo-visual-planhead">
            <span className="largo-visual-tpl">{plan.template}</span>
            {plan.matchedIntent === false && (
              <span className="largo-visual-note">chosen from available evidence, not from the question</span>
            )}
            {plan.dimensions && (
              <span className="largo-visual-dim">
                {plan.dimensions.width}×{plan.dimensions.height}
              </span>
            )}
          </div>

          {/* The values the card will assert, shown BEFORE the asset exists. */}
          <ul className="largo-visual-values">
            {plan.preview?.spot && <li><span>Spot</span><b>{plan.preview.spot}</b></li>}
            {plan.preview?.levels.map((l) => (
              <li key={l.label}><span>{l.label}</span><b>{l.value}</b></li>
            ))}
            {plan.preview?.metrics.map((m) => (
              <li key={m.label}><span>{m.label}</span><b>{m.value}</b></li>
            ))}
            {plan.preview?.trade && (
              <li>
                <span>{plan.preview.trade.ticker}</span>
                <b>
                  {plan.preview.trade.return ?? "—"}
                  {plan.preview.trade.graded === false ? " (open · not booked)" : ""}
                </b>
              </li>
            )}
          </ul>

          <p className="largo-visual-asof">
            Snapshot {plan.dataAsOf ? new Date(plan.dataAsOf).toLocaleTimeString() : "unknown"}
            {plan.freshness ? ` · ${plan.freshness}` : ""}
            {plan.systemsQueried?.length ? ` · ${plan.systemsQueried.join(" · ")}` : ""}
          </p>

          {plan.rejected?.length ? (
            <p className="largo-visual-note">
              {plan.rejected.map((r) => `${r.template} needs ${r.needs}`).join(" · ")}
            </p>
          ) : null}

          <div className="largo-visual-row">
            <button type="button" className="largo-visual-cta" onClick={render} disabled={busy}>
              {busy ? "Rendering…" : imgUrl ? "Re-render" : "Render image"}
            </button>
            {/* The card, inline in the answer. Injected markup is produced entirely server-side from
              our own templates — no user or model text reaches it as HTML. */}
          {markup && (
            <div className="largo-visual-scroll">
              <div dangerouslySetInnerHTML={{ __html: markup.html }} />
            </div>
          )}

          {imgUrl && (
              <a className="largo-visual-cta" href={imgUrl} download={`blackout-${plan.template?.toLowerCase()}.png`}>
                Download PNG
              </a>
            )}
            {markup?.svg && (
              <button type="button" className="largo-visual-cta" onClick={() => void copy("svg")}>
                {copied === "svg" ? "Copied" : "Copy SVG"}
              </button>
            )}
            {markup && (
              <button type="button" className="largo-visual-cta" onClick={() => void copy("html")}>
                {copied === "html" ? "Copied" : "Copy HTML"}
              </button>
            )}
            <button type="button" className="largo-visual-chip" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>

          {/* The card, inline in the answer. Injected markup is produced entirely server-side from
              our own templates — no user or model text reaches it as HTML. */}
          {markup && (
            <div className="largo-visual-scroll">
              <div dangerouslySetInnerHTML={{ __html: markup.html }} />
            </div>
          )}

          {imgUrl && (
            // A blob URL from an in-memory render: next/image needs a static or remote-configured
            // source, so it would add nothing here and cannot resolve a blob.
            // eslint-disable-next-line @next/next/no-img-element
            <img className="largo-visual-preview" src={imgUrl} alt={`${plan.template} card preview`} />
          )}
        </div>
      )}
    </div>
  );
}
