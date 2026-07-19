import { requireAdmin } from "@/lib/admin-access";
import { PageHeader } from "@/components/ui";
import { UserManagement } from "@/components/admin/UserManagement";

export const revalidate = 0;

export default async function AdminUsersPage() {
  await requireAdmin();

  return (
    <div className="admin-page admin-page-canvas">
      <main id="main" className="admin-page-main">
        <PageHeader
          className="mb-6"
          kicker="Administration"
          title="User Management"
          subtitle="Clerk users, Whop subscriptions, tier overrides, and access control."
        />
        <UserManagement />
      </main>
    </div>
  );
}
