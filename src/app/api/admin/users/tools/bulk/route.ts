import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { resolveAdminApi } from "@/lib/admin-access";
import { logAdminAction } from "@/lib/admin-audit";
import { isCognitoAuth } from "@/lib/auth-provider";
import { parseTier } from "@/lib/tiers";
import {
  mergeToolAccessMap,
  parseToolAccessMap,
  type ToolAccessMode,
} from "@/lib/tool-user-access";
import { setToolAccessForUserId } from "@/lib/tool-access-server";
import type { ToolKey } from "@/lib/tool-access";
import { TOOLS } from "@/lib/tool-access";

export const dynamic = "force-dynamic";

const VALID_TOOLS = new Set<ToolKey>(TOOLS.map((t) => t.key));

type BulkBody = {
  tier: string;
  tool: ToolKey;
  mode: ToolAccessMode;
  /** Safety cap — default 200 users per bulk run. */
  limit?: number;
};

export async function POST(req: NextRequest) {
  const { actor, denied } = await resolveAdminApi();
  if (denied) return denied;

  if (isCognitoAuth()) {
    return NextResponse.json({ error: "Tool bulk updates require Clerk auth." }, { status: 501 });
  }

  const body = (await req.json()) as BulkBody;
  const tier = parseTier(body.tier);
  const tool = body.tool;
  const mode = body.mode;
  const limit = Math.min(500, Math.max(1, Number(body.limit ?? 200)));

  if (!VALID_TOOLS.has(tool)) {
    return NextResponse.json({ error: "Invalid tool key" }, { status: 400 });
  }
  if (mode !== "inherit" && mode !== "grant" && mode !== "block") {
    return NextResponse.json({ error: "Invalid mode — use inherit, grant, or block" }, { status: 400 });
  }

  const client = await clerkClient();
  let offset = 0;
  let updated = 0;
  let scanned = 0;
  const errors: string[] = [];

  while (updated < limit) {
    const page = await client.users.getUserList({ limit: 100, offset });
    if (page.data.length === 0) break;

    for (const user of page.data) {
      if (updated >= limit) break;
      scanned += 1;
      const meta = (user.publicMetadata ?? {}) as Record<string, unknown>;
      const userTier = parseTier(meta.tier);
      if (userTier !== tier) continue;

      try {
        const current = parseToolAccessMap(meta.tool_access);
        const next = mergeToolAccessMap(current, { [tool]: mode });
        await setToolAccessForUserId(user.id, next);
        updated += 1;
      } catch (err) {
        errors.push(`${user.id}: ${err instanceof Error ? err.message : "update failed"}`);
      }
    }

    offset += page.data.length;
    if (offset >= page.totalCount) break;
  }

  void logAdminAction({
    actorUserId: actor?.userId,
    actorEmail: actor?.email,
    action: "admin_tool_access_bulk",
    detail: { tier, tool, mode, updated, scanned, errors: errors.slice(0, 5) },
  });

  return NextResponse.json({
    ok: true,
    tier,
    tool,
    mode,
    updated,
    scanned,
    errors: errors.slice(0, 10),
  });
}

/** PATCH body helper — moved out of route for reuse. */