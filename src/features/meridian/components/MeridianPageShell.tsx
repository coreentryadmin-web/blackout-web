"use client";

import { PageShell } from "@/components/ui";
import { MeridianDesk } from "@/features/meridian/components/MeridianDesk";

export function MeridianPageShell() {
  return (
    <PageShell
      fullBleed
      contentClassName="meridian-page-content !py-0 flex min-h-0 flex-1 flex-col"
      className="meridian-page-shell min-h-0 flex-1"
    >
      <div className="meridian-page-root flex min-h-0 flex-1 flex-col px-2 pb-4 pt-3 md:px-4">
        <MeridianDesk />
      </div>
    </PageShell>
  );
}
