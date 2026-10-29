import { bad, handle } from "@/lib/api";
import { getArmToken, requireAdmin } from "@/lib/auth";
import { patchSubscription, reductionWindow } from "@/lib/billing/client";
import { config } from "@/lib/config";
import { getBillingView, getTenantSnapshot, invalidate, listTenants } from "@/lib/data/service";
import { graphSubFor } from "@/lib/billing/match";
import { activeSubs } from "@/lib/optimizer/seats";
import { lookupPrice } from "@/lib/pricing/priceBook";
import { writeAudit } from "@/lib/store";
import type { AuditEntry } from "@/lib/types";

async function audit(e: AuditEntry) {
  try {
    await writeAudit(e);
  } catch (err) {
    console.error("[audit] write failed", JSON.stringify(e), err);
  }
}

export const dynamic = "force-dynamic";

/**
 * MCA billing changes, executed with the signed-in admin's own ARM token.
 *  reduce        lower seat quantity; only inside the post-purchase/renewal 7-day window,
 *                never below the SKU's currently assigned seats
 *  autoRenewOff  whole subscription lapses at term end (requires typing the SKU part number)
 *  autoRenewOn   undo
 */
export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireAdmin(req);
    const body = (await req.json()) as {
      tenant: string;
      subscription: string;
      action: "reduce" | "autoRenewOff" | "autoRenewOn";
      quantity?: number;
      confirmText?: string;
      dryRun?: boolean;
    };
    if (!listTenants().some((t) => t.id === body.tenant)) bad("Unknown tenant");
    const view = await getBillingView(body.tenant);
    if (view.status !== "ok") bad(view.message);
    const b = view.items.find((x) => x.name.toLowerCase() === String(body.subscription).toLowerCase());
    if (!b) bad("Subscription not found in your MCA billing account (it may be billed through a partner).");

    invalidate(body.tenant); // decide on fresh seat counts, not a 15-minute-old snapshot
    const snap = await getTenantSnapshot(body.tenant);
    const graphSub = graphSubFor(snap, view.items, b.name, (p) => lookupPrice(p).displayName);
    const skuPart = graphSub?.skuPartNumber;
    const sku = snap.skus.find((s) => s.skuPartNumber === skuPart);
    if (!sku || !skuPart) {
      bad("Could not match this billing subscription to a SKU in the tenant, so the seat floor cannot be checked. Use the M365 admin center instead.");
    }
    let props: { quantity?: number; autoRenew?: "On" | "Off" };
    let detail: string;

    if (body.action === "reduce") {
      const q = Number(body.quantity);
      if (!Number.isInteger(q) || q < 0) bad("Quantity must be a whole number");
      if (q >= b.quantity) bad(`New quantity must be lower than the current ${b.quantity}`);
      const w = reductionWindow(b);
      if (!w.open) bad(`Seat reduction is not allowed now. Microsoft only allows it within 7 days after purchase or renewal${w.endsAt ? ` (last window ended ${w.endsAt.slice(0, 10)})` : ""}.`);
      const otherSubsQty = activeSubs(snap, sku.skuPartNumber)
        .filter((s) => s.id !== graphSub?.id)
        .reduce((a, s) => a + s.totalLicenses, 0);
      if (q + otherSubsQty < sku.assigned) {
        bad(`That would leave ${q + otherSubsQty} seats for ${sku.assigned} assigned licenses. Remove licenses from users first.`);
      }
      props = { quantity: q };
      detail = `quantity ${b.quantity} -> ${q}`;
    } else if (body.action === "autoRenewOff") {
      if (body.confirmText !== skuPart) bad(`Type ${skuPart} to confirm turning auto-renew off`);
      props = { autoRenew: "Off" };
      detail = `autoRenew ${b.autoRenew} -> Off (whole subscription lapses ${b.termEndDate?.slice(0, 10) ?? "at term end"})`;
    } else if (body.action === "autoRenewOn") {
      props = { autoRenew: "On" };
      detail = `autoRenew ${b.autoRenew} -> On`;
    } else bad("Unknown action");

    if (body.dryRun) return { dryRun: true, subscription: b.name, detail };

    let status = 200;
    let operation: string | null = null;
    const target = `${skuPart} (${b.name})`;
    if (config.dataMode === "live") {
      const { token } = await getArmToken();
      if (!token) bad("Billing session expired. Refresh the billing session and try again.");
      try {
        ({ status, operation } = await patchSubscription(token, b, props));
      } catch (e) {
        await audit({ at: new Date().toISOString(), actor: me.name, tenantId: snap.tenant.tenantId, action: body.action === "reduce" ? "reduce-seats" : "auto-renew", target, detail: `${detail} FAILED: ${(e as Error).message}`.slice(0, 2000), result: "failed" });
        throw e;
      }
    }
    await audit({
      at: new Date().toISOString(),
      actor: me.name,
      tenantId: snap.tenant.tenantId,
      action: body.action === "reduce" ? "reduce-seats" : "auto-renew",
      target,
      detail: `${detail}${status === 202 ? " [accepted, completing asynchronously]" : ""}`,
      result: config.dataMode === "live" ? "success" : "dry-run",
    });
    invalidate(body.tenant);
    return { dryRun: false, status, operation, detail, mock: config.dataMode !== "live" };
  });
}
