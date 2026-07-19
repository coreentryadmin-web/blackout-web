import Link from "next/link";
import { clsx } from "clsx";
import { ProductMark } from "@/components/marks/ProductMark";
import { getLaunchStatusSnapshot, type LaunchSource, type ToolSigil } from "@/lib/tool-access";

const SIGIL_BY_KEY: Record<string, ToolSigil> = {
  spx: "spx",
  flows: "helix",
  heatmap: "heatmap",
  largo: "largo",
  nighthawk: "nighthawk",
};

function sourceLabel(source: LaunchSource): string {
  if (source === "default") return "always live";
  if (source === "env") return "LAUNCHED_TOOLS";
  return "locked";
}

/** Collapsible launch gate readout — shown on the Operations tab. */
export function AdminLaunchStatusPanel() {
  const status = getLaunchStatusSnapshot();

  return (
    <details className="admin-v2-details">
      <summary className="admin-v2-details-summary">
        Tool launch · {status.open_count}/{status.total_count} open for premium users
      </summary>
      <div className="admin-v2-details-body space-y-4">
        <p className="font-mono text-[11px] leading-relaxed text-white/55">
          Non-admin premium users only see tools marked open. Admins bypass all gates. Set{" "}
          <code className="rounded bg-white/5 px-1">LAUNCHED_TOOLS</code> on the ECS task to unlock
          additional tools without a deploy.
        </p>

        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-[11px]">
          <span className="text-white/40">LAUNCHED_TOOLS=</span>
          <span className={clsx("font-semibold", status.launched_tools_env ? "text-gold" : "text-white/50")}>
            {status.launched_tools_env ?? "(unset)"}
          </span>
        </div>

        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {status.tools.map((tool) => {
            const sigil = SIGIL_BY_KEY[tool.key];
            return (
              <li
                key={tool.key}
                className={clsx(
                  "flex items-center gap-3 rounded-lg border px-3 py-2.5",
                  tool.launched ? "border-bull/25 bg-bull/5" : "border-white/10 bg-white/[0.02]"
                )}
              >
                {sigil ? <ProductMark product={sigil} size={28} /> : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium text-white/90">{tool.label}</p>
                  <p className="font-mono text-[10px] text-white/45">{sourceLabel(tool.launch_source)}</p>
                </div>
                <div className="flex flex-shrink-0 flex-col items-end gap-1">
                  <span
                    className={clsx(
                      "font-mono text-[10px] font-semibold uppercase",
                      tool.launched ? "text-bull" : "text-gold"
                    )}
                  >
                    {tool.launched ? "Open" : "Locked"}
                  </span>
                  <Link
                    href={tool.href}
                    className="font-mono text-[10px] text-white/40 hover:text-cyan-300"
                  >
                    {tool.href}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}
