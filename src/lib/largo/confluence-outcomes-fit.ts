// Fitting for get_confluence_outcomes Largo transport cap.
// Both zerodte_nighthawk_echo and spx_slayer_shadow_factors arrays were
// exceeding 16k cap when using 60-day windows. Reduce to 30 days for Largo;
// product consumers (Night Hawk edition builder, etc.) use full 60-day data directly.
//
// This is product-first data design: all native data available to products,
// fitting applied only at Largo model boundary.

export interface ConfluenceOutcomesFittedResult {
  zerodte_nighthawk_echo: any[] | null;
  spx_slayer_shadow_factors: any[] | null;
  zerodte_shown: number;
  zerodte_truncated: boolean;
  spx_shown: number;
  spx_truncated: boolean;
  window_days: number;
}

export function fitConfluenceOutcomesForModel(
  raw: { zerodte_nighthawk_echo: any[] | null; spx_slayer_shadow_factors: any[] | null },
  targetWindowDays = 30
): { fitted: ConfluenceOutcomesFittedResult } {
  // The functions return arrays of outcome buckets. For Largo, we limit to top entries
  // and add explicit "shown" flags so the model understands what was omitted.
  const zdteRows = raw.zerodte_nighthawk_echo || [];
  const spxRows = raw.spx_slayer_shadow_factors || [];

  // Soft cap: keep top 30 entries per bucket (most recent, highest impact)
  const zdteCap = 30;
  const spxCap = 30;

  const zdteShown = Math.min(zdteRows.length, zdteCap);
  const spxShown = Math.min(spxRows.length, spxCap);

  const fitted: ConfluenceOutcomesFittedResult = {
    zerodte_nighthawk_echo: zdteRows.slice(0, zdteShown).length > 0 ? zdteRows.slice(0, zdteShown) : null,
    spx_slayer_shadow_factors: spxRows.slice(0, spxShown).length > 0 ? spxRows.slice(0, spxShown) : null,
    zerodte_shown: zdteShown,
    zerodte_truncated: zdteRows.length > zdteCap,
    spx_shown: spxShown,
    spx_truncated: spxRows.length > spxCap,
    window_days: targetWindowDays,
  };

  return { fitted };
}
