import { Suspense } from "react";
import type { Metadata } from "next";
import { AdminAnalyticsDashboard } from "@/components/admin/AdminAnalyticsDashboard";
import { noindexPageMetadata } from "@/lib/page-metadata";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = noindexPageMetadata("Admin · BlackOut", "/admin");

export default function AdminPage() {
  return (
    <div className="admin-page admin-page-v2">
      <main id="main" className="admin-page-main">
        <Suspense fallback={<p className="admin-api-muted p-6">Loading admin…</p>}>
          <AdminAnalyticsDashboard />
        </Suspense>
      </main>
    </div>
  );
}
