import { FEATURE_MATRIX } from "@/lib/upsell-features";

// Presentational only. Server component (no hooks). Renders the Free-vs-Premium
// matrix using existing color tokens. No grey text (bull/bear/purple/white/sky).
export function FeatureComparison() {
  return (
    <section className="mt-16 text-left" aria-label="Plan comparison">
      <p className="font-mono text-[10px] tracking-[0.4em] text-purple-light uppercase mb-4 text-center">
        What you unlock
      </p>

      <div className="border border-purple/30">
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 px-4 py-3 border-b border-purple/30">
          <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-sky-300">
            Feature
          </span>
          <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-bear text-center w-16">
            Free
          </span>
          <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-bull text-center w-20">
            Premium
          </span>
        </div>

        {FEATURE_MATRIX.map((row, i) => (
          <div
            key={row.label}
            className={
              "grid grid-cols-[1fr_auto_auto] items-center gap-x-4 px-4 py-3" +
              (i < FEATURE_MATRIX.length - 1 ? " border-b border-purple/15" : "")
            }
          >
            <div className="min-w-0">
              <p className="text-white text-sm font-semibold leading-tight">{row.label}</p>
              <p className="text-sky-300 text-xs leading-snug mt-0.5">{row.detail}</p>
            </div>
            <span className="w-16 text-center text-base" aria-label={row.free ? "Included" : "Not included"}>
              {row.free ? (
                <span className="text-bull">✓</span>
              ) : (
                <span className="text-bear">—</span>
              )}
            </span>
            <span className="w-20 text-center text-base" aria-label={row.premium ? "Included" : "Not included"}>
              {row.premium ? (
                <span className="text-bull">✓</span>
              ) : (
                <span className="text-bear">—</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
