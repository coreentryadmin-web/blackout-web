import { FEATURE_MATRIX } from "@/lib/upsell-features";
import { ProductMark } from "@/components/marks/ProductMark";
import { MEMBERSHIP_PRICING, usd } from "@/lib/pricing";

/** One ✓/— cell, kept as a helper so the three tier columns render identically. */
function Cell({ included, className }: { included: boolean; className: string }) {
  return (
    <span className={className + " text-center text-sm"} aria-label={included ? "Included" : "Not included"}>
      {included ? <span className="text-bull">✓</span> : <span className="text-white/15">—</span>}
    </span>
  );
}

export function FeatureComparison() {
  return (
    <section className="mx-auto mt-16 max-w-4xl text-left" aria-label="Plan comparison">
      <p className="mb-6 text-center font-mono text-[10px] uppercase tracking-[0.4em] text-bull">
        What you get
      </p>

      <div className="overflow-x-auto rounded-2xl border border-white/[0.08] bg-[#050608]/60 backdrop-blur-md">
        <div className="grid min-w-[560px] grid-cols-[1fr_auto_auto_auto] items-center gap-x-6 border-b border-white/[0.08] px-5 py-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Feature</span>
          <span className="w-16 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-white/30">Free</span>
          <span className="w-24 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
            SPX Slayer
            <span className="block normal-case tracking-normal text-white/30">{usd(MEMBERSHIP_PRICING.community)}/mo</span>
          </span>
          <span className="w-24 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-bull">
            Premium
            <span className="block normal-case tracking-normal text-bull/60">{usd(MEMBERSHIP_PRICING.monthly)}/mo</span>
          </span>
        </div>

        {FEATURE_MATRIX.map((row, i) => (
          <div
            key={row.label}
            className={
              "grid min-w-[560px] grid-cols-[1fr_auto_auto_auto] items-center gap-x-6 px-5 py-3.5 transition-colors hover:bg-white/[0.02]" +
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
            <Cell included={row.free} className="w-16" />
            <Cell included={row.community} className="w-24" />
            <Cell included={row.premium} className="w-24" />
          </div>
        ))}
      </div>
    </section>
  );
}
