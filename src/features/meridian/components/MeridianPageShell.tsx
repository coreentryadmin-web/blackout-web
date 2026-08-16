"use client";

import { PageShell, PageHeader, FreshnessChip } from "@/components/ui";
import { MeridianDesk } from "@/features/meridian/components/MeridianDesk";

export function MeridianPageShell() {
  return (
    <PageShell
      fullBleed
      contentClassName="meridian-page-content !py-0 flex min-h-0 flex-1 flex-col"
      className="meridian-page-shell min-h-0 flex-1"
    >
      <div className="meridian-page-root flex min-h-0 flex-1 flex-col px-2 pb-4 pt-4 md:px-3">
        <PageHeader
          kicker="Catalyst structure desk"
          title="Meridian"
          badge={
            <span className="flex items-center gap-2">
              <span className="meridian-mark" aria-hidden="true">
                ✦
              </span>
              <FreshnessChip status="live" label="Live" />
            </span>
          }
          className="meridian-page-header mb-3 shrink-0 [&_.t-kicker]:font-bold [&_.t-kicker]:text-sky-300"
        />
        <MeridianDesk />
      </div>
    </PageShell>
  );
}
