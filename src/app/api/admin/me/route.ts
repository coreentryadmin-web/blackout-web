import { NextResponse } from "next/server";
import { getAdminStatus } from "@/lib/admin-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getAdminStatus();
  return NextResponse.json(status);
}
