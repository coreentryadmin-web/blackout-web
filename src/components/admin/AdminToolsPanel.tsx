"use client";

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { ProductMark } from "@/components/marks/ProductMark";
import type { ToolKey } from "@/lib/tool-access";
import type { ToolAccessMode, ToolAccessRow } from "@/lib/tool-user-access";
import { ActionButton, DataTable, FilterSelect, GlassPanel, MegaStat } from "@/components/admin/AdminUi";

type GlobalToolRow = {
  key: ToolKey;
  label: string;
  href: string;
  defaultLaunched: boolean;
  globalLaunched: boolean;
  launchSource: string;
};

type ToolsAccessPayload = {
  launched_tools_env: string | null;
  open_count: number;
  total_count: number;
  locked_keys: ToolKey[];
  tools: GlobalToolRow[];
};

const SIGIL: Partial<Record<ToolKey, "spx" | "helix" | "heatmap" | "largo" | "nighthawk" | "vector">> = {
  spx: "spx",
  flows: "helix",
  heatmap: "heatmap",
  largo: "largo",
  nighthawk: "nighthawk",
  vector: "vector",
};

export function AdminToolsPanel() {
  const [data, setData] = useState<ToolsAccessPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [bulkTier, setBulkTier] = useState("premium");
  const [bulkTool, setBulkTool] = useState<ToolKey>("largo");
  const [bulkMode, setBulkMode] = useState<ToolAccessMode>("grant");
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/tools/access", { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runBulk = async () => {
    setBulkRunning(true);
    setBulkResult(null);
    try {
      const res = await fetch("/api/admin/users/tools/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: bulkTier, tool: bulkTool, mode: bulkMode, limit: 200 }),
      });
      const json = await res.json();
      if (!res.ok) {
        setBulkResult(json.error ?? "Bulk update failed");
        return;
      }
      setBulkResult(`Updated ${json.updated} user(s) on tier "${bulkTier}" for ${bulkTool}.`);
    } finally {
      setBulkRunning(false);
    }
  };

  if (loading && !data) {
    return <p className="admin-api-muted">Loading tool access…</p>;
  }

  if (!data) {
    return <p className="admin-api-muted">Could not load tool access config.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MegaStat label="Tools live (global)" value={`${data.open_count}/${data.total_count}`} tone="bull" />
        <MegaStat
          label="Locked globally"
          value={String(data.locked_keys.length)}
          sub={data.locked_keys.join(", ") || "none"}
          tone={data.locked_keys.length ? "amber" : "neutral"}
        />
        <MegaStat
          label="LAUNCHED_TOOLS"
          value={data.launched_tools_env ? "set" : "unset"}
          sub={data.launched_tools_env ?? "defaults only"}
          tone="cyan"
        />
        <MegaStat label="Per-user overrides" value="Clerk" sub="tool_access metadata" tone="violet" />
      </div>

      <GlassPanel title="Global launch gate" accent="cyan" kicker="Premium users · server env">
        <p className="mb-4 text-[12px] leading-relaxed text-white/55">
          Tools marked <strong className="text-white/80">locked</strong> show Coming Soon for premium
          users unless unlocked via <code className="rounded bg-white/5 px-1">LAUNCHED_TOOLS</code> on
          ECS or a per-user <code className="rounded bg-white/5 px-1">grant</code> override below.
          Admins always bypass all gates.
        </p>
        <DataTable>
          <thead>
            <tr>
              <th>Tool</th>
              <th>Route</th>
              <th>Global</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {data.tools.map((t) => (
              <tr key={t.key}>
                <td>
                  <div className="flex items-center gap-2">
                    {SIGIL[t.key] ? <ProductMark product={SIGIL[t.key]!} size={24} /> : null}
                    <span className="font-medium text-white/90">{t.label}</span>
                  </div>
                </td>
                <td className="font-mono text-[11px] text-white/45">{t.href}</td>
                <td>
                  <StatusPill ok={t.globalLaunched} label={t.globalLaunched ? "Open" : "Locked"} />
                </td>
                <td className="font-mono text-[10px] uppercase text-white/40">{t.launchSource}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </GlassPanel>

      <GlassPanel title="Tier bulk override" accent="violet" kicker="Apply to many users">
        <p className="mb-4 text-[12px] text-white/55">
          Grant or block a tool for every user on a tier (scans Clerk, max 200 updates per run).
          Per-user edits in the user table still win for individuals.
        </p>
        <div className="flex flex-wrap gap-3 items-end">
          <FilterSelect
            label="Tier"
            value={bulkTier}
            onChange={setBulkTier}
            options={[
              { value: "premium", label: "Premium" },
              { value: "community", label: "Community ($75)" },
              { value: "free", label: "Free" },
            ]}
          />
          <FilterSelect
            label="Tool"
            value={bulkTool}
            onChange={(v) => setBulkTool(v as ToolKey)}
            options={data.tools.map((t) => ({ value: t.key, label: t.label }))}
          />
          <FilterSelect
            label="Access"
            value={bulkMode}
            onChange={(v) => setBulkMode(v as ToolAccessMode)}
            options={[
              { value: "grant", label: "Force unlock" },
              { value: "block", label: "Force block" },
              { value: "inherit", label: "Clear override" },
            ]}
          />
          <ActionButton variant="primary" onClick={() => void runBulk()} disabled={bulkRunning}>
            {bulkRunning ? "Applying…" : "Apply to tier"}
          </ActionButton>
        </div>
        {bulkResult && <p className="mt-3 font-mono text-[11px] text-cyan-300/90">{bulkResult}</p>}
      </GlassPanel>
    </div>
  );
}

export function UserToolAccessEditor({
  rows,
  value,
  onChange,
}: {
  rows: ToolAccessRow[];
  value: Record<ToolKey, ToolAccessMode>;
  onChange: (next: Record<ToolKey, ToolAccessMode>) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-white/45 leading-relaxed">
        Override global launch gates for this user. <span className="text-white/65">Grant</span> unlocks
        locked tools (e.g. Largo, Vector). <span className="text-white/65">Block</span> hides a tool even
        when globally live.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map((row) => (
          <label
            key={row.key}
            className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              {SIGIL[row.key] ? <ProductMark product={SIGIL[row.key]!} size={22} /> : null}
              <div className="min-w-0">
                <p className="truncate text-[12px] font-medium text-white/90">{row.label}</p>
                <p className="font-mono text-[10px] text-white/35">
                  global: {row.globalLaunched ? "open" : "locked"} · now:{" "}
                  {row.effective ? "allowed" : "denied"}
                </p>
              </div>
            </div>
            <select
              className="admin-filter-select shrink-0 text-[11px]"
              value={value[row.key] ?? row.mode}
              onChange={(e) =>
                onChange({ ...value, [row.key]: e.target.value as ToolAccessMode })
              }
            >
              <option value="inherit">Inherit</option>
              <option value="grant">Grant</option>
              <option value="block">Block</option>
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={clsx(
        "inline-flex rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase",
        ok ? "bg-bull/15 text-bull" : "bg-gold/10 text-gold"
      )}
    >
      {label}
    </span>
  );
}
