import { Suspense } from "react";
import { requireAdmin } from "@/lib/admin-access";
import { AdminAnalyticsDashboard } from "@/components/admin/AdminAnalyticsDashboard";

export const revalidate = 0;

export default async function AdminPage() {
  await requireAdmin();

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
