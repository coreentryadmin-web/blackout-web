"use client";

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import {
  GlassPanel,
  ActionButton,
  FilterSearch,
  FilterSelect,
  DataTable,
  MegaStat,
  ConfirmModal,
} from "@/components/admin/AdminUi";
import { Modal } from "@/components/ui";

type UserRow = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
  tier: string;
  role: string;
  whopUserId: string | null;
  whopMembershipId: string | null;
  createdAt: number;
  lastSignInAt: number | null;
  banned: boolean;
};

type UserDetail = UserRow & {
  allEmails: string[];
  publicMetadata: Record<string, unknown>;
  lastActiveAt: number | null;
  phoneNumbers: string[];
};

type UsersResponse = {
  users: UserRow[];
  total: number;
  page: number;
  limit: number;
  pages: number;
};

export function UserManagement() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [banConfirm, setBanConfirm] = useState<UserRow | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "20" });
    if (query) params.set("q", query);
    if (tierFilter) params.set("tier", tierFilter);
    if (roleFilter) params.set("role", roleFilter);

    try {
      const res = await fetch(`/api/admin/users?${params}`);
      if (!res.ok) return;
      const data: UsersResponse = await res.json();
      setUsers(data.users);
      setTotal(data.total);
      setPages(data.pages);
    } finally {
      setLoading(false);
    }
  }, [page, query, tierFilter, roleFilter]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleSearch = (v: string) => {
    setQuery(v);
    setPage(1);
  };

  const openUserDetail = async (userId: string) => {
    const res = await fetch(`/api/admin/users/${userId}`);
    if (!res.ok) return;
    const data: UserDetail = await res.json();
    setSelectedUser(data);
    setEditOpen(true);
  };

  const syncWhop = async (email: string) => {
    setSyncing(email);
    try {
      const res = await fetch("/api/admin/users/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        await fetchUsers();
        if (selectedUser?.email === email) {
          const detail = await fetch(`/api/admin/users/${selectedUser.id}`);
          if (detail.ok) setSelectedUser(await detail.json());
        }
      }
    } finally {
      setSyncing(null);
    }
  };

  const handleBan = async () => {
    if (!banConfirm) return;
    await fetch(`/api/admin/users/${banConfirm.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ banned: !banConfirm.banned }),
    });
    setBanConfirm(null);
    fetchUsers();
  };

  const premiumCount = users.filter((u) => u.tier === "premium").length;
  const adminCount = users.filter((u) => u.role === "admin").length;

  return (
    <div className="space-y-6">
      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MegaStat label="Total users" value={String(total)} tone="cyan" />
        <MegaStat label="Premium (page)" value={String(premiumCount)} tone="bull" />
        <MegaStat label="Admins (page)" value={String(adminCount)} tone="violet" />
        <MegaStat label="Page" value={`${page}/${pages}`} tone="neutral" />
      </div>

      {/* Filters */}
      <GlassPanel accent="cyan">
        <div className="flex flex-wrap gap-3 items-end">
          <FilterSearch
            label="Search"
            value={query}
            onChange={handleSearch}
            placeholder="Email, name, or user ID…"
          />
          <FilterSelect
            label="Tier"
            value={tierFilter}
            onChange={(v) => { setTierFilter(v); setPage(1); }}
            options={[
              { value: "", label: "All tiers" },
              { value: "premium", label: "Premium" },
              { value: "free", label: "Free" },
            ]}
          />
          <FilterSelect
            label="Role"
            value={roleFilter}
            onChange={(v) => { setRoleFilter(v); setPage(1); }}
            options={[
              { value: "", label: "All roles" },
              { value: "admin", label: "Admins" },
              { value: "member", label: "Members" },
            ]}
          />
          <ActionButton variant="primary" onClick={() => setCreateOpen(true)}>
            + Create user
          </ActionButton>
        </div>
      </GlassPanel>

      {/* User table */}
      <GlassPanel accent="cyan" title="Users">
        {loading ? (
          <p className="admin-api-muted p-4">Loading users…</p>
        ) : users.length === 0 ? (
          <p className="admin-api-muted p-4">No users found.</p>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th className="admin-th">User</th>
                <th className="admin-th">Tier</th>
                <th className="admin-th">Role</th>
                <th className="admin-th">Whop</th>
                <th className="admin-th">Joined</th>
                <th className="admin-th">Last seen</th>
                <th className="admin-th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="admin-tr">
                  <td className="admin-td">
                    <div className="flex items-center gap-2">
                      {user.imageUrl && (
                        <img
                          src={user.imageUrl}
                          alt=""
                          className="w-6 h-6 rounded-full"
                        />
                      )}
                      <div>
                        <p className="text-xs text-white/90 font-mono">
                          {user.firstName} {user.lastName}
                        </p>
                        <p className="text-[10px] text-white/40 font-mono truncate max-w-[180px]">
                          {user.email ?? user.id}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="admin-td">
                    <TierBadge tier={user.tier} />
                  </td>
                  <td className="admin-td">
                    <RoleBadge role={user.role} />
                  </td>
                  <td className="admin-td">
                    <span className={clsx(
                      "text-[10px] font-mono",
                      user.whopMembershipId ? "text-bull/70" : "text-white/20"
                    )}>
                      {user.whopMembershipId ? "linked" : "—"}
                    </span>
                  </td>
                  <td className="admin-td">
                    <span className="text-[10px] text-white/40 font-mono">
                      {formatDate(user.createdAt)}
                    </span>
                  </td>
                  <td className="admin-td">
                    <span className="text-[10px] text-white/40 font-mono">
                      {user.lastSignInAt ? formatDate(user.lastSignInAt) : "never"}
                    </span>
                  </td>
                  <td className="admin-td">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => openUserDetail(user.id)}
                        className="admin-action-btn text-[10px] px-2 py-0.5"
                      >
                        Edit
                      </button>
                      {user.email && (
                        <button
                          type="button"
                          onClick={() => syncWhop(user.email!)}
                          disabled={syncing === user.email}
                          className="admin-action-btn text-[10px] px-2 py-0.5"
                        >
                          {syncing === user.email ? "…" : "Sync"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setBanConfirm(user)}
                        className={clsx(
                          "admin-action-btn admin-action-btn-danger text-[10px] px-2 py-0.5",
                          user.banned && "opacity-60"
                        )}
                      >
                        {user.banned ? "Unban" : "Ban"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/5">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="admin-action-btn text-[10px]"
            >
              ← Prev
            </button>
            <span className="text-[10px] text-white/40 font-mono">
              Page {page} of {pages} ({total} users)
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page >= pages}
              className="admin-action-btn text-[10px]"
            >
              Next →
            </button>
          </div>
        )}
      </GlassPanel>

      {/* Edit user modal */}
      {selectedUser && (
        <EditUserModal
          user={selectedUser}
          open={editOpen}
          onClose={() => { setEditOpen(false); setSelectedUser(null); }}
          onSaved={() => { fetchUsers(); setEditOpen(false); setSelectedUser(null); }}
          onSync={() => selectedUser.email ? syncWhop(selectedUser.email) : undefined}
          syncing={syncing === selectedUser.email}
        />
      )}

      {/* Create user modal */}
      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { setCreateOpen(false); fetchUsers(); }}
      />

      {/* Ban confirm */}
      <ConfirmModal
        open={!!banConfirm}
        title={banConfirm?.banned ? "Unban user?" : "Ban user?"}
        body={
          banConfirm?.banned
            ? `This will restore access for ${banConfirm.email ?? banConfirm.id}.`
            : `This will immediately block ${banConfirm?.email ?? banConfirm?.id} from signing in.`
        }
        confirmLabel={banConfirm?.banned ? "Unban" : "Ban"}
        onConfirm={handleBan}
        onCancel={() => setBanConfirm(null)}
      />
    </div>
  );
}

function EditUserModal({
  user,
  open,
  onClose,
  onSaved,
  onSync,
  syncing,
}: {
  user: UserDetail;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onSync: () => void;
  syncing: boolean;
}) {
  const [firstName, setFirstName] = useState(user.firstName ?? "");
  const [lastName, setLastName] = useState(user.lastName ?? "");
  const [tier, setTier] = useState(user.tier);
  const [role, setRole] = useState(user.role);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, tier, role }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Save failed");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" className="admin-confirm-modal">
      <p className="admin-confirm-kicker">User detail</p>
      <h3 className="admin-confirm-title">
        {user.firstName} {user.lastName}
      </h3>
      <p className="text-xs text-white/40 font-mono mb-4">{user.id}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="admin-filter-label block mb-1">First name</label>
          <input
            className="admin-filter-input w-full"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <div>
          <label className="admin-filter-label block mb-1">Last name</label>
          <input
            className="admin-filter-input w-full"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
        <div>
          <label className="admin-filter-label block mb-1">Tier</label>
          <select
            className="admin-filter-select w-full"
            value={tier}
            onChange={(e) => setTier(e.target.value)}
          >
            <option value="free">free</option>
            <option value="premium">premium</option>
          </select>
        </div>
        <div>
          <label className="admin-filter-label block mb-1">Role</label>
          <select
            className="admin-filter-select w-full"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="">member</option>
            <option value="admin">admin</option>
          </select>
        </div>
      </div>

      {/* Info section */}
      <div className="border-t border-white/5 pt-3 mb-4">
        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-white/50">
          <div>
            <span className="text-white/30">Emails: </span>
            {user.allEmails?.join(", ") ?? "—"}
          </div>
          <div>
            <span className="text-white/30">Phone: </span>
            {user.phoneNumbers?.join(", ") ?? "—"}
          </div>
          <div>
            <span className="text-white/30">Whop user: </span>
            {user.whopUserId ?? "—"}
          </div>
          <div>
            <span className="text-white/30">Whop membership: </span>
            {user.whopMembershipId ?? "—"}
          </div>
          <div>
            <span className="text-white/30">Created: </span>
            {formatDate(user.createdAt)}
          </div>
          <div>
            <span className="text-white/30">Last sign-in: </span>
            {user.lastSignInAt ? formatDate(user.lastSignInAt) : "never"}
          </div>
          <div>
            <span className="text-white/30">Last active: </span>
            {user.lastActiveAt ? formatDate(user.lastActiveAt) : "—"}
          </div>
          <div>
            <span className="text-white/30">Banned: </span>
            {user.banned ? "YES" : "no"}
          </div>
        </div>
      </div>

      {/* Metadata */}
      <details className="mb-4">
        <summary className="text-[10px] text-white/30 font-mono cursor-pointer">
          Raw publicMetadata
        </summary>
        <pre className="admin-json-block text-[10px] mt-1 max-h-32 overflow-auto">
          {JSON.stringify(user.publicMetadata, null, 2)}
        </pre>
      </details>

      {error && (
        <p className="text-[11px] text-red-400 font-mono mb-2">{error}</p>
      )}

      <div className="admin-confirm-actions">
        <ActionButton onClick={onClose}>Cancel</ActionButton>
        <ActionButton onClick={onSync} disabled={syncing || !user.email}>
          {syncing ? "Syncing…" : "Sync Whop"}
        </ActionButton>
        <ActionButton onClick={save} disabled={saving} variant="primary">
          {saving ? "Saving…" : "Save changes"}
        </ActionButton>
      </div>
    </Modal>
  );
}

function CreateUserModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [tier, setTier] = useState("free");
  const [role, setRole] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/users/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, phone, firstName, lastName, tier, role }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Create failed");
        return;
      }
      setEmail("");
      setPhone("");
      setFirstName("");
      setLastName("");
      setTier("free");
      setRole("");
      onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="md" className="admin-confirm-modal">
      <p className="admin-confirm-kicker">New user</p>
      <h3 className="admin-confirm-title">Create user manually</h3>
      <p className="text-[10px] text-white/30 font-mono mb-4">
        Creates a Clerk account. Clerk requires a phone number.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div className="sm:col-span-2">
          <label className="admin-filter-label block mb-1">Email *</label>
          <input
            className="admin-filter-input w-full"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="admin-filter-label block mb-1">Phone *</label>
          <input
            className="admin-filter-input w-full"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1234567890"
          />
        </div>
        <div>
          <label className="admin-filter-label block mb-1">First name</label>
          <input
            className="admin-filter-input w-full"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <div>
          <label className="admin-filter-label block mb-1">Last name</label>
          <input
            className="admin-filter-input w-full"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
        <div>
          <label className="admin-filter-label block mb-1">Tier</label>
          <select
            className="admin-filter-select w-full"
            value={tier}
            onChange={(e) => setTier(e.target.value)}
          >
            <option value="free">free</option>
            <option value="premium">premium</option>
          </select>
        </div>
        <div>
          <label className="admin-filter-label block mb-1">Role</label>
          <select
            className="admin-filter-select w-full"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="">member</option>
            <option value="admin">admin</option>
          </select>
        </div>
      </div>

      {error && (
        <p className="text-[11px] text-red-400 font-mono mb-2">{error}</p>
      )}

      <div className="admin-confirm-actions">
        <ActionButton onClick={onClose}>Cancel</ActionButton>
        <ActionButton onClick={submit} disabled={saving || !email || !phone} variant="primary">
          {saving ? "Creating…" : "Create user"}
        </ActionButton>
      </div>
    </Modal>
  );
}

function TierBadge({ tier }: { tier: string }) {
  return (
    <span
      className={clsx(
        "inline-block px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider",
        tier === "premium"
          ? "bg-bull/15 text-bull border border-bull/20"
          : "bg-white/5 text-white/40 border border-white/10"
      )}
    >
      {tier}
    </span>
  );
}

function RoleBadge({ role }: { role: string }) {
  if (role === "admin") {
    return (
      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-violet-500/15 text-violet-300 border border-violet-500/20">
        admin
      </span>
    );
  }
  return <span className="text-[10px] text-white/20 font-mono">—</span>;
}

function formatDate(ts: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
