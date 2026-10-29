import { DOWNGRADE_TARGET, PRICE_BOOK, lookupPrice } from "@/lib/pricing/priceBook";
import type { Recommendation, TenantSnapshot, UserActivity } from "@/lib/types";

/**
 * Rule-based cost optimization engine. Pure function of a snapshot, so it is
 * deterministic and unit-testable, and identical in mock and live mode.
 *
 * Savings are POTENTIAL monthly savings. Removing a license from a user only
 * saves money once the seat count is reduced on the subscription (for NCE
 * annual terms, at renewal), so the UI always pairs rules 2-5 with rule 1.
 */
export interface EngineOptions {
  inactivityDays: number;
  /** Ignore unassigned waste below this monthly amount */
  minUnassignedWaste?: number;
}

const PAID_BASE_TIERS = new Set(["premium", "standard"]);

/** Only judge (in)activity when we have usage data and the account is older than the window. */
export function activityIsReliable(u: UserActivity, inactivityDays: number, now = Date.now()): boolean {
  if (u.activityKnown === false) return false;
  if (u.createdDateTime && now - Date.parse(u.createdDateTime) < inactivityDays * 86_400_000) return false;
  return true;
}

export function lastActive(u: UserActivity): Date | null {
  const dates = [u.lastExchange, u.lastOneDrive, u.lastSharePoint, u.lastTeams]
    .filter(Boolean)
    .map((d) => new Date(d as string).getTime());
  return dates.length ? new Date(Math.max(...dates)) : null;
}

function daysSince(d: string | null | undefined, now: number): number {
  if (!d) return Infinity;
  return Math.floor((now - new Date(d).getTime()) / 86_400_000);
}

function paidSkus(u: UserActivity) {
  return u.skuPartNumbers.map((s) => ({ sku: s, p: lookupPrice(s) })).filter((x) => x.p.monthly > 0);
}

export function runOptimizer(snap: TenantSnapshot, opts: EngineOptions): Recommendation[] {
  const now = Date.now();
  const recs: Recommendation[] = [];
  const handled = new Set<string>();
  const t = opts.inactivityDays;

  // Rule 1: unassigned paid licenses
  for (const s of snap.skus) {
    if (s.isFree || s.isTrial || s.isPool || s.unassigned <= 0 || s.unitPriceMonthly <= 0) continue;
    if (s.wastedMonthly < (opts.minUnassignedWaste ?? 0)) continue;
    recs.push({
      id: `unassigned-${s.skuPartNumber}`,
      type: "unassigned",
      severity: s.wastedMonthly >= 500 ? "high" : s.wastedMonthly >= 100 ? "medium" : "low",
      title: `${s.unassigned} unassigned ${s.displayName}`,
      detail: `${s.purchased} purchased, ${s.assigned} assigned. Paying for ${s.unassigned} idle seats.`,
      fromSku: s.skuPartNumber,
      quantity: s.unassigned,
      monthlySavings: s.wastedMonthly,
      action: "Reduce seat count at next renewal/term change, or assign to pending hires.",
    });
  }

  for (const u of snap.users) {
    const paid = paidSkus(u);
    if (!paid.length) continue;

    // Rule 2: disabled accounts still holding paid licenses
    if (!u.accountEnabled) {
      handled.add(u.id);
      const total = paid.reduce((a, x) => a + x.p.monthly, 0);
      recs.push({
        id: `disabled-${u.id}`,
        type: "disabled-account",
        severity: "high",
        title: `Disabled account holds ${paid.length} paid license(s)`,
        detail: `${u.displayName} is sign-in blocked but still licensed: ${paid.map((x) => x.p.displayName).join(", ")}.`,
        user: u.userPrincipalName,
        quantity: paid.length,
        monthlySavings: round(total),
        action: "Confirm offboarding is complete (convert mailbox to shared if needed), then remove licenses.",
      });
      continue;
    }

    // Rule 3: inactive users (no Exchange/OneDrive/SharePoint/Teams activity in N days)
    const last = lastActive(u);
    const inactiveDays = last ? Math.floor((now - last.getTime()) / 86_400_000) : Infinity;
    const base = paid.filter((x) => PAID_BASE_TIERS.has(x.p.tier));
    if (activityIsReliable(u, t, now) && inactiveDays > t && base.length) {
      handled.add(u.id);
      const total = paid.reduce((a, x) => a + x.p.monthly, 0);
      recs.push({
        id: `inactive-${u.id}`,
        type: "inactive-user",
        severity: total >= 60 ? "high" : "medium",
        title: last ? `No activity for ${inactiveDays} days` : "No recorded activity",
        detail: `${u.displayName} (${u.department ?? "no dept"}) holds ${paid.map((x) => x.p.displayName).join(", ")} with no core-service usage in ${t}+ days.`,
        user: u.userPrincipalName,
        fromSku: base[0].sku,
        quantity: paid.length,
        monthlySavings: round(total),
        action: "Verify with manager. Remove license, or downgrade to F3/Business Basic if the account must stay.",
      });
      continue;
    }

    // Rule 4: duplicate / overlapping licenses
    for (const a of u.skuPartNumbers) {
      const inc = PRICE_BOOK[a]?.includes ?? [];
      for (const b of u.skuPartNumbers) {
        if (a === b || !inc.includes(b)) continue;
        const pb = lookupPrice(b);
        if (pb.monthly <= 0) continue;
        recs.push({
          id: `dup-${u.id}-${b}`,
          type: "duplicate-license",
          severity: "medium",
          title: `${pb.displayName} duplicated by ${lookupPrice(a).displayName}`,
          detail: `${u.displayName} already gets ${pb.displayName} capabilities through ${lookupPrice(a).displayName}.`,
          user: u.userPrincipalName,
          fromSku: b,
          quantity: 1,
          monthlySavings: pb.monthly,
          action: `Remove ${pb.displayName} from the user (check service plans first).`,
        });
      }
    }

    // Rule 5: tier consolidation - mail/Teams-only users on full-suite SKUs
    if (handled.has(u.id) || !activityIsReliable(u, t, now)) continue;
    const collabIdle = daysSince(u.lastOneDrive, now) > t && daysSince(u.lastSharePoint, now) > t;
    if (!collabIdle) continue;
    for (const x of base) {
      const target = DOWNGRADE_TARGET[x.sku];
      if (!target) continue;
      const tp = lookupPrice(target);
      const delta = round(x.p.monthly - tp.monthly);
      if (delta <= 0) continue;
      const isE5 = x.sku === "SPE_E5";
      recs.push({
        id: `downgrade-${u.id}-${x.sku}`,
        type: "tier-downgrade",
        severity: delta >= 40 ? "medium" : "low",
        title: `${x.p.displayName} → ${tp.displayName}`,
        detail: isE5
          ? `${u.displayName} uses mail/Teams only. Usage reports cannot see E5-only features (Defender P2, Power BI Pro, Teams Phone, Purview), so confirm none are in use first.`
          : `${u.displayName} uses mail/Teams only; no OneDrive/SharePoint activity in ${t}+ days. ${tp.displayName} may fit (check mailbox size and desktop-app needs).`,
        user: u.userPrincipalName,
        fromSku: x.sku,
        toSku: target,
        quantity: 1,
        monthlySavings: delta,
        action: `Pilot a swap to ${tp.displayName} via group-based licensing.`,
      });
    }
  }

  return recs.sort((a, b) => b.monthlySavings - a.monthlySavings);
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
