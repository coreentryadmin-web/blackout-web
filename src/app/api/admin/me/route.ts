import { NextResponse } from "next/server";
import { getAdminStatus, requireAdminApi } from "@/lib/admin-access";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const status = await getAdminStatus();
  return NextResponse.json(status, { headers: NO_STORE_HEADERS });
}
