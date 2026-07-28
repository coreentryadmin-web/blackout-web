import { FEATURE_MATRIX } from "@/lib/upsell-features";
import { ProductMark } from "@/components/marks/ProductMark";

export function FeatureComparison() {
  return (
    <section className="mx-auto mt-16 max-w-3xl text-left" aria-label="Plan comparison">
      <p className="mb-6 text-center font-mono text-[10px] uppercase tracking-[0.4em] text-bull">
        What you get
      </p>

      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#050608]/60 backdrop-blur-md">
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-b border-white/[0.08] px-5 py-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Feature</span>
          <span className="w-16 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-white/30">Free</span>
          <span className="w-20 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-bull">Premium</span>
        </div>

        {FEATURE_MATRIX.map((row, i) => (
          <div
            key={row.label}
            className={
              "grid grid-cols-[1fr_auto_auto] items-center gap-x-6 px-5 py-3.5 transition-colors hover:bg-white/[0.02]" +
              (i < FEATURE_MATRIX.length - 1 ? " border-b border-white/[0.04]" : "")
            }
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2.5 text-sm font-medium leading-tight text-white/90">
                {row.mark && (
                  <ProductMark product={row.mark} size={20} animated={false} className="shrink-0 opacity-70" />
                )}
                {row.label}
              </p>
              <p className="mt-0.5 text-xs leading-snug text-white/35">{row.detail}</p>
            </div>
            <span className="w-16 text-center text-sm" aria-label={row.free ? "Included" : "Not included"}>
              {row.free ? <span className="text-bull/70">✓</span> : <span className="text-white/15">—</span>}
            </span>
            <span className="w-20 text-center text-sm" aria-label={row.premium ? "Included" : "Not included"}>
              {row.premium ? <span className="text-bull">✓</span> : <span className="text-white/15">—</span>}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
