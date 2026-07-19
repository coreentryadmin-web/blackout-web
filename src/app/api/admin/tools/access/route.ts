import { NextResponse } from "next/server";
import { resolveAdminApi } from "@/lib/admin-access";
import { getLaunchStatusSnapshot, TOOLS, type ToolKey } from "@/lib/tool-access";
import { buildToolAccessRows } from "@/lib/tool-user-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const { denied } = await resolveAdminApi();
  if (denied) return denied;

  const snapshot = getLaunchStatusSnapshot();
  const globalLaunched = (key: ToolKey) =>
    snapshot.tools.find((t) => t.key === key)?.launched ?? false;

  return NextResponse.json({
    launched_tools_env: snapshot.launched_tools_env,
    env_launched_keys: snapshot.env_launched_keys,
    tools: TOOLS.map((t) => ({
      key: t.key,
      label: t.label,
      href: t.href,
      defaultLaunched: t.defaultLaunched,
      globalLaunched: globalLaunched(t.key),
      launchSource: snapshot.tools.find((r) => r.key === t.key)?.launch_source ?? "locked",
    })),
    open_count: snapshot.open_count,
    total_count: snapshot.total_count,
    locked_keys: snapshot.locked_keys,
    /** Example row shape for UI previews (no user overrides). */
    access_preview: buildToolAccessRows(globalLaunched, undefined),
  });
}
