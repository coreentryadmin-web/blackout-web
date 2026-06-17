import { requireAdmin } from "@/lib/admin-access";
import { Nav } from "@/components/Nav";
import { AdminAnalyticsDashboard } from "@/components/admin/AdminAnalyticsDashboard";

export const revalidate = 0;

export default async function AdminPage() {
  await requireAdmin();

  return (
    <div className="admin-page admin-page-canvas">
      <Nav />
      <main className="admin-page-main">
        <AdminAnalyticsDashboard />
      </main>
    </div>
  );
}
