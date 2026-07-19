"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AdminApiDashboard } from "@/components/admin/AdminApiDashboard";
import { AdminCronDashboard } from "@/components/admin/AdminCronDashboard";
import { AdminNightHawkDashboard } from "@/components/admin/AdminNightHawkDashboard";
import { AdminSpxDashboard } from "@/components/admin/AdminSpxDashboard";
import { AdminOperationsDashboard } from "@/components/admin/AdminOperationsDashboard";
import { AdminBieDashboard } from "@/components/admin/AdminBieDashboard";
import { AdminShell, type AdminTabId } from "@/components/admin/AdminShell";
import { TabCanvas } from "@/components/admin/AdminUi";
import { TrackRecordView } from "@/components/track-record";

function parseTab(value: string | null): AdminTabId {
  if (
    value === "spx" ||
    value === "nighthawk" ||
    value === "ops" ||
    value === "apis" ||
    value === "crons" ||
    value === "bie" ||
    value === "track-record"
  ) {
    return value;
  }
  return "ops";
}

export function AdminAnalyticsDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<AdminTabId>(() => parseTab(searchParams.get("tab")));

  useEffect(() => {
    setTab(parseTab(searchParams.get("tab")));
  }, [searchParams]);

  const selectTab = useCallback(
    (next: AdminTabId) => {
      setTab(next);
      const params = new URLSearchParams(searchParams.toString());
      if (next === "ops") params.delete("tab");
      else params.set("tab", next);
      if (next !== "spx" && next !== "ops") params.delete("section");
      const qs = params.toString();
      router.replace(qs ? `/admin?${qs}` : "/admin", { scroll: false });
    },
    [router, searchParams]
  );

  return (
    <AdminShell tab={tab} onTabChange={selectTab}>
      <div key={tab} className="admin-tab-panel">
        {tab === "ops" && (
          <TabCanvas theme="neutral">
            <AdminOperationsDashboard />
          </TabCanvas>
        )}
        {tab === "apis" && (
          <TabCanvas theme="api">
            <AdminApiDashboard />
          </TabCanvas>
        )}
        {tab === "crons" && (
          <TabCanvas theme="api">
            <AdminCronDashboard />
          </TabCanvas>
        )}
        {tab === "spx" && (
          <TabCanvas theme="spx">
            <AdminSpxDashboard />
          </TabCanvas>
        )}
        {tab === "nighthawk" && (
          <TabCanvas theme="neutral">
            <AdminNightHawkDashboard />
          </TabCanvas>
        )}
        {tab === "track-record" && (
          <TabCanvas theme="neutral">
            <TrackRecordView embedded />
          </TabCanvas>
        )}
        {tab === "bie" && (
          <TabCanvas theme="neutral">
            <AdminBieDashboard />
          </TabCanvas>
        )}
      </div>
    </AdminShell>
  );
}
