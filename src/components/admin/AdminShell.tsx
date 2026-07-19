"use client";

import Link from "next/link";
import { clsx } from "clsx";
import { AdminHealthBanner } from "@/components/admin/AdminHealthBanner";

export type AdminTabId =
  | "ops"
  | "apis"
  | "crons"
  | "spx"
  | "nighthawk"
  | "track-record"
  | "bie";

type NavItem = { id: AdminTabId; label: string };

const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Platform",
    items: [
      { id: "ops", label: "Operations" },
      { id: "apis", label: "API telemetry" },
      { id: "crons", label: "Crons" },
      { id: "bie", label: "Intelligence" },
    ],
  },
  {
    title: "Desks",
    items: [
      { id: "spx", label: "SPX Slayer" },
      { id: "nighthawk", label: "Night Hawk" },
      { id: "track-record", label: "Track record" },
    ],
  },
];

type AdminShellProps = {
  tab: AdminTabId;
  onTabChange: (tab: AdminTabId) => void;
  children: React.ReactNode;
};

export function AdminShell({ tab, onTabChange, children }: AdminShellProps) {
  return (
    <div className="admin-v2">
      <aside className="admin-v2-sidebar" aria-label="Admin navigation">
        <div className="admin-v2-sidebar-head">
          <p className="admin-v2-kicker">BlackOut</p>
          <h1 className="admin-v2-title">Admin</h1>
        </div>

        <nav className="admin-v2-nav">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="admin-v2-nav-group">
              <p className="admin-v2-nav-group-label">{group.title}</p>
              <ul className="admin-v2-nav-list">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={clsx("admin-v2-nav-item", tab === item.id && "admin-v2-nav-item-active")}
                      aria-current={tab === item.id ? "page" : undefined}
                      onClick={() => onTabChange(item.id)}
                    >
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="admin-v2-sidebar-foot">
          <Link href="/admin/users" className="admin-v2-foot-link">
            User management
          </Link>
        </div>
      </aside>

      <div className="admin-v2-main">
        <header className="admin-v2-topbar">
          <AdminHealthBanner compact />
        </header>
        <div className="admin-v2-content">{children}</div>
      </div>
    </div>
  );
}
