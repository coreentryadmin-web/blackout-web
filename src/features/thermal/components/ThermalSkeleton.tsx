import { Skeleton } from "@/components/ui";

/**
 * The one Thermal loading placeholder.
 *
 * Extracted from the inline versions in Heatmap.tsx and GexHeatmap.tsx (before this,
 * the outer route paint showed a single 520px block, then hydration swapped in a
 * denser 5-tile + rail layout — a ~200ms shape-jump the eye reads as jank). This
 * component now feeds BOTH: outer dynamic-import loader and inner "not-ready" branch,
 * so the first frame already matches the final layout.
 *
 * The variant prop is a mild size hint — the outer loader uses `hero` (single tall
 * block) because it renders before the client bundle even knows what pair the user
 * lands on, while the inner branch uses `matrix` (the full 5-tile + rail geometry).
 * Both carry `role="status"` + an SR label so screen readers get "Loading heatmap…"
 * (the old aria-hidden version was silent).
 */
export function ThermalSkeleton({ variant = "matrix" }: { variant?: "hero" | "matrix" }) {
  if (variant === "hero") {
    return (
      <div
        className="desk-layout space-y-5"
        role="status"
        aria-label="Loading BlackOut Thermal — dealer gamma matrix"
      >
        {/* motion-safe: — was bare `animate-pulse` which ignores `prefers-reduced-motion`.
            This fires on every cold-page paint and the built-in Skeleton primitive
            below already uses the motion-safe pattern; mirror it here. */}
        <div className="h-[520px] rounded-2xl border border-white/10 bg-black/40 motion-safe:animate-pulse" />
        <span className="sr-only">Loading heatmap…</span>
      </div>
    );
  }
  return (
    <div
      className="space-y-5"
      role="status"
      aria-label="Loading dealer gamma matrix"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} height={92} rounded="xl" />
        ))}
      </div>
      <Skeleton height={44} rounded="lg" />
      <div className="grid gap-4 lg:grid-cols-[1.62fr_1fr]">
        <div className="space-y-2">
          <Skeleton height={28} rounded="lg" />
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} height={22} rounded="md" />
          ))}
        </div>
        <div className="space-y-3">
          <Skeleton height={120} rounded="xl" />
          <Skeleton height={160} rounded="xl" />
          <Skeleton height={120} rounded="xl" />
        </div>
      </div>
      <span className="sr-only">Loading heatmap…</span>
    </div>
  );
}
