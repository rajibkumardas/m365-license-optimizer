import { NextResponse } from "next/server";
import { getAllSummaries } from "@/lib/data/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const { summaries, errors } = await getAllSummaries();
  return NextResponse.json({ tenants: summaries, errors });
}
