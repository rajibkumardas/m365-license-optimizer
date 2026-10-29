import { matchBilling } from "@/lib/billing/match";
import { activityIsReliable, lastActive } from "@/lib/optimizer/engine";
import { lookupPrice } from "@/lib/pricing/priceBook";
import type { BillingSubscription, LicenseSku, SkuSubscription, TenantSnapshot, UserActivity } from "@/lib/types";

/**
 * Seat plan for one SKU: who holds a license they don't use, how many seats the SKU really
 * needs, and how that reduction lands on each subscription (soonest renewal first).
 * Pure function, shared by the SKU detail page, the forecast and the reminder job.
 */
export interface ReclaimableUser {
  id: string;
  displayName: string;
  userPrincipalName: string;
  reason: "disabled" | "inactive";
  lastActive: string | null;
  /** Assigned through group-based licensing: remove the user from the group instead */
  viaGroup: boolean;
}

export interface SubscriptionPlan {
  sub: SkuSubscription;
  billing?: BillingSubscription;
  /** unknown = billing data not loaded (no billing session / background job) */
  channel: "mca" | "csp-or-other" | "unknown";
  renewal: string | null;
  currentQty: number;
  targetQty: number;
  cut: number;
  windowOpen: boolean;
  windowEndsAt: string | null;
}

export interface SeatPlan {
  sku: LicenseSku;
  reclaimable: ReclaimableUser[];
  /** Seats needed after reclaiming: assigned - reclaimable + buffer */
  neededSeats: number;
  idleSeats: number;
  subs: SubscriptionPlan[];
  monthlySavings: number;
}

export function activeSubs(snap: TenantSnapshot, skuPartNumber: string) {
  return snap.subscriptions.filter((s) => s.skuPartNumber === skuPartNumber && s.status === "Enabled" && !s.isTrial);
}

export function reclaimableUsers(users: UserActivity[], skuPartNumber: string, inactivityDays: number): ReclaimableUser[] {
  const now = Date.now();
  const out: ReclaimableUser[] = [];
  for (const u of users) {
    if (!u.skuPartNumbers.includes(skuPartNumber)) continue;
    const last = lastActive(u);
    const days = last ? (now - last.getTime()) / 86_400_000 : Infinity;
    const reason = !u.accountEnabled ? "disabled" : activityIsReliable(u, inactivityDays, now) && days > inactivityDays ? "inactive" : null;
    if (!reason) continue;
    out.push({
      id: u.id,
      displayName: u.displayName,
      userPrincipalName: u.userPrincipalName,
      reason,
      lastActive: last ? last.toISOString() : null,
      viaGroup: (u.groupAssignedSkus ?? []).includes(skuPartNumber),
    });
  }
  return out.sort((a, b) => (a.reason === b.reason ? a.displayName.localeCompare(b.displayName) : a.reason === "disabled" ? -1 : 1));
}

export function buildSeatPlan(
  snap: TenantSnapshot,
  sku: LicenseSku,
  billing: BillingSubscription[],
  opts: { inactivityDays: number; seatBuffer: number },
): SeatPlan {
  const reclaimable = sku.isPool || sku.isFree || sku.isTrial ? [] : reclaimableUsers(snap.users, sku.skuPartNumber, opts.inactivityDays);
  const neededSeats = sku.isPool ? sku.purchased : Math.max(0, sku.assigned - reclaimable.length + opts.seatBuffer);
  let toCut = sku.isPool || sku.isFree || sku.isTrial ? 0 : Math.max(0, sku.purchased - neededSeats);
  const idleSeats = toCut;
  const matched = matchBilling(snap, billing, (p) => lookupPrice(p).displayName);
  const now = Date.now();

  const billingKnown = billing.length > 0;
  // Only active, paid subscriptions keep seats (trials, grace/suspended and deleted ones do not)
  const subs = activeSubs(snap, sku.skuPartNumber)
    .sort((a, b) => (a.nextLifecycleDateTime ?? "9999").localeCompare(b.nextLifecycleDateTime ?? "9999"))
    .map((sub): SubscriptionPlan => {
      const b = matched.get(sub.id);
      const currentQty = b?.quantity ?? sub.totalLicenses;
      const cut = Math.min(currentQty, toCut);
      toCut -= cut;
      const windowEnd = b?.cancellationAllowedEndDate ? Date.parse(b.cancellationAllowedEndDate) : null;
      return {
        sub,
        billing: b,
        channel: b ? "mca" : billingKnown ? "csp-or-other" : "unknown",
        renewal: b?.termEndDate ?? sub.nextLifecycleDateTime ?? null,
        currentQty,
        targetQty: currentQty - cut,
        cut,
        windowOpen: !!b && b.cancellation === "Allowed" && windowEnd !== null && now <= windowEnd,
        windowEndsAt: b?.cancellationAllowedEndDate ?? null,
      };
    });

  const price = lookupPrice(sku.skuPartNumber).monthly;
  return { sku, reclaimable, neededSeats, idleSeats, subs, monthlySavings: Math.round(idleSeats * price * 100) / 100 };
}
