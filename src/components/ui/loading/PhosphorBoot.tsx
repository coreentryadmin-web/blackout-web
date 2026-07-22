// PHOSPHOR BOOT — the route-transition loader for the PHOSPHOR LADDER system.
//
// Rendered by app-router loading.tsx boundaries, so it must stay a pure server
// component with zero data/Nav dependencies. All motion lives in
// phosphor-loading.css (imported once from the root layout) and is fully
// prefers-reduced-motion gated there — this file only emits static markup.
//
// The eight rungs are the desk's gamma ladder powering on: the gold KING rung,
// bull call-side and bear put-side walls, and the sky spot reference. They are
// decorative-but-honest — the same primitives the live ladder draws — which is
// the whole point of the design system ("data is the only ornament").

const RUNGS: Array<{ k: "bull" | "bear" | "king" | "ref" }> = [
  { k: "bull" },
  { k: "bull" },
  { k: "king" },
  { k: "bear" },
  { k: "ref" },
  { k: "bear" },
  { k: "bull" },
  { k: "bear" },
];

export function PhosphorBoot({ label = "Warming phosphor" }: { label?: string }) {
  return (
    <div className="pboot" role="status" aria-live="polite" aria-label={`${label}…`}>
      <div className="pboot-crt">
        <span className="pboot-mark font-anton">BLACKOUT</span>

        <div className="pboot-rail" aria-hidden="true">
          {RUNGS.map((r, i) => (
            <span key={i} className="pboot-rung" data-k={r.k} />
          ))}
        </div>

        <div className="pboot-status" aria-hidden="true">
          <span className="pboot-caret" />
          <span>{label}</span>
        </div>
      </div>
    </div>
  );
}

export default PhosphorBoot;
