import { NextResponse } from "next/server";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Used by App Service Health check (Monitoring > Health check > path: /api/health). */
export function GET() {
  return NextResponse.json({ status: "ok", dataMode: config.dataMode, time: new Date().toISOString() });
}
