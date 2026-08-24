import Link from "next/link";
import type { Metadata } from "next";
import { UserManagement } from "@/components/admin/UserManagement";
import { noindexPageMetadata } from "@/lib/page-metadata";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = noindexPageMetadata("User management · Admin · BlackOut", "/admin/users");

export default function AdminUsersPage() {
  return (
    <div className="admin-page admin-page-v2">
      <main id="main" className="admin-page-main admin-v2-users-page">
        <header className="admin-v2-users-header">
          <div>
            <p className="admin-v2-kicker">Administration</p>
            <h1 className="admin-v2-title">User management</h1>
            <p className="admin-v2-users-sub">
              Accounts, billing sync, tier overrides, and per-user tool access.
            </p>
          </div>
          <Link href="/admin" className="admin-v2-foot-link">
            ← Back to console
          </Link>
        </header>
        <UserManagement />
      </main>
    </div>
  );
}
