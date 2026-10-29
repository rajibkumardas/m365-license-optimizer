import { NextResponse } from "next/server";
import { getRecommendations, listTenants } from "@/lib/data/service";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (!listTenants().some((t) => t.id === tenantId)) return NextResponse.json({ error: "Unknown tenant" }, { status: 404 });
  try {
    const recs = await getRecommendations(tenantId);
    return NextResponse.json({
      count: recs.length,
      monthlySavings: Math.round(recs.reduce((a, r) => a + r.monthlySavings, 0) * 100) / 100,
      recommendations: recs,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
