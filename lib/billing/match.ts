import type { BillingSubscription, SkuSubscription, TenantSnapshot } from "@/lib/types";

/**
 * Join Graph subscriptions (/directory/subscriptions) to MCA billing subscriptions.
 *
 * Verified on a live MCA tenant (Oct 2026): the IDs do NOT match (Graph id/commerceSubscriptionId
 * never equals the billing subscription name), so we match on what both sides agree on:
 *   1. same provisioning tenant (a billing account can serve several tenants)
 *   2. product name (billing productType ~ SKU display name)
 *   3. same end date (Graph nextLifecycleDateTime == billing termEndDate, UTC calendar day, +-1)
 *   4. same seat count (tie-breaker; relaxed only if exactly one candidate remains)
 * Matching is one-to-one. Anything ambiguous stays unmatched, which disables billing actions
 * for that row instead of risking a change to the wrong subscription.
 */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const day = (iso?: string | null) => (iso ? Date.parse(iso.slice(0, 10)) : NaN);
const sameDay = (a?: string | null, b?: string | null) => Math.abs(day(a) - day(b)) <= 86_400_000;

function nameMatches(productType: string | null | undefined, skuName: string) {
  if (!productType) return false;
  const p = norm(productType);
  const s = norm(skuName);
  return p === s || p.includes(s) || s.includes(p);
}

const INACTIVE = new Set(["Disabled", "Cancelled", "Deleted", "Expired", "Failed"]);

export function matchBilling(
  snap: TenantSnapshot,
  billing: BillingSubscription[],
  skuName: (skuPartNumber: string) => string,
): Map<string, BillingSubscription> {
  const out = new Map<string, BillingSubscription>();
  const pool = billing.filter(
    (b) => !INACTIVE.has(b.status) && (!b.provisioningTenantId || b.provisioningTenantId.toLowerCase() === snap.tenant.tenantId.toLowerCase()),
  );
  const used = new Set<string>();
  // Exact quantity first across all subscriptions, then a relaxed pass, so exact matches win.
  for (const strict of [true, false]) {
    for (const s of snap.subscriptions) {
      if (out.has(s.id) || s.status === "Deleted" || !s.nextLifecycleDateTime) continue;
      const cands = pool.filter(
        (b) =>
          !used.has(b.name) &&
          nameMatches(b.productType ?? b.displayName, skuName(s.skuPartNumber)) &&
          sameDay(b.termEndDate, s.nextLifecycleDateTime) &&
          (!strict || b.quantity === s.totalLicenses),
      );
      if (cands.length === 1) {
        out.set(s.id, cands[0]);
        used.add(cands[0].name);
      }
    }
  }
  return out;
}

/** Reverse lookup: which Graph subscription (and SKU) a billing subscription belongs to. */
export function graphSubFor(
  snap: TenantSnapshot,
  billing: BillingSubscription[],
  billingName: string,
  skuName: (skuPartNumber: string) => string,
): SkuSubscription | undefined {
  const m = matchBilling(snap, billing, skuName);
  for (const s of snap.subscriptions) if (m.get(s.id)?.name.toLowerCase() === billingName.toLowerCase()) return s;
  return undefined;
}
