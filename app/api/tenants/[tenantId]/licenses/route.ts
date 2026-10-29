import { NextResponse } from "next/server";
import { getTenantSnapshot, listTenants } from "@/lib/data/service";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (!listTenants().some((t) => t.id === tenantId)) return NextResponse.json({ error: "Unknown tenant" }, { status: 404 });
  try {
    const snap = await getTenantSnapshot(tenantId);
    return NextResponse.json({ tenant: snap.tenant, currency: snap.currency, skus: snap.skus, warnings: snap.warnings });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
