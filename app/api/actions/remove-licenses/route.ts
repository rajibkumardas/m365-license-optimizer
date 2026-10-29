import { bad, handle } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { config } from "@/lib/config";
import { getTenantSnapshot, invalidate, listTenants, tenantConfig } from "@/lib/data/service";
import { removeUserLicense } from "@/lib/graph/client";
import { reclaimableUsers } from "@/lib/optimizer/seats";
import { writeAudit } from "@/lib/store";

async function auditSafe(e: Parameters<typeof writeAudit>[0]) {
  try {
    await writeAudit(e);
  } catch (err) {
    console.error("[audit] write failed", JSON.stringify(e), err);
  }
}

export const dynamic = "force-dynamic";

/**
 * Remove one SKU from selected users. Server-side guards:
 *  - only users the engine classifies as disabled/inactive for that SKU (no arbitrary user IDs)
 *  - group-assigned licenses are refused (remove the user from the group instead)
 *  - max 50 users per call; dryRun returns the plan without changing anything
 */
export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireAdmin(req);
    const body = (await req.json()) as { tenant: string; skuPartNumber: string; userIds: string[]; dryRun?: boolean };
    if (!listTenants().some((t) => t.id === body.tenant)) bad("Unknown tenant");
    const userIds = [...new Set(Array.isArray(body.userIds) ? body.userIds.map(String) : [])];
    if (!userIds.length) bad("Select at least one user");
    if (userIds.length > 50) bad("Maximum 50 users per request");

    if (!body.dryRun) invalidate(body.tenant); // decide on fresh data before changing anything
    const snap = await getTenantSnapshot(body.tenant);
    const sku = snap.skus.find((s) => s.skuPartNumber === body.skuPartNumber);
    if (!sku) bad("Unknown SKU");
    if (sku.isFree || sku.isTrial || sku.isPool) bad("Free, trial and pool SKUs are not reclaimed here.");
    const eligible = new Map(reclaimableUsers(snap.users, sku.skuPartNumber, config.inactivityDays).map((u) => [u.id, u]));
    const plan = userIds.map((id) => {
      const u = eligible.get(id);
      if (!u) return { id, upn: id, status: "refused" as const, reason: "Not flagged as disabled/inactive for this SKU" };
      if (u.viaGroup) return { id, upn: u.userPrincipalName, status: "refused" as const, reason: "Assigned by a group: remove the user from the licensing group" };
      return { id, upn: u.userPrincipalName, status: "ready" as const, reason: u.reason };
    });

    if (body.dryRun) return { dryRun: true, plan };

    const results = [];
    for (const p of plan) {
      if (p.status !== "ready") {
        results.push(p);
        continue;
      }
      try {
        if (config.dataMode === "live") await removeUserLicense(tenantConfig(body.tenant), p.id, sku.skuId);
        results.push({ ...p, status: "removed" as const });
      } catch (e) {
        results.push({ ...p, status: "failed" as const, reason: (e as Error).message.slice(0, 200) });
      }
    }
    const ok = results.filter((r) => r.status === "removed").length;
    await auditSafe({
      at: new Date().toISOString(),
      actor: me.name,
      tenantId: snap.tenant.tenantId,
      action: "remove-licenses",
      target: sku.skuPartNumber,
      detail: results.map((r) => `${r.upn}:${r.status}`).join("; ").slice(0, 30000),
      result: config.dataMode !== "live" ? "dry-run" : ok === results.length ? "success" : ok ? "partial" : "failed",
    });
    invalidate(body.tenant);
    return { dryRun: false, removed: ok, results, mock: config.dataMode !== "live" };
  });
}
