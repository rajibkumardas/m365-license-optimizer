import "server-only";
import { lookupPrice } from "@/lib/pricing/priceBook";
import type { BillingSubscription, MonthlySpend, SkuSubscription, UserActivity } from "@/lib/types";

/**
 * DEMO DATA ONLY. Tenants, quantities, users and spend history are all synthetic
 * (fictional companies, generated numbers). Nothing here comes from a real tenant.
 */
export interface MockSku {
  skuPartNumber: string;
  purchased: number;
  assigned: number;
  trial?: boolean;
  /** "P1M" monthly term; default annual */
  term?: "P1M" | "P1Y";
  /** "csp" = billed through a partner, invisible to the MCA billing API */
  channel?: "mca" | "csp";
}

export interface MockTenant {
  id: string;
  name: string;
  tenantId: string;
  skus: MockSku[];
  spendHistory: MonthlySpend[];
  spendHistorySource: string;
  userPrefix: string;
  domain: string;
}

const DEMO_MONTHS = [
  "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03",
  "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09",
];

function synthHistory(base: number, seed: number): MonthlySpend[] {
  const rng = mulberry32(seed);
  return DEMO_MONTHS.map((month, i) => ({
    month,
    amount: Math.round(base * (0.9 + i * 0.012 + rng() * 0.08)),
  }));
}

export const MOCK_TENANTS: MockTenant[] = [
  {
    id: "tailspin",
    name: "Tailspin Logistics (demo)",
    tenantId: "11111111-1111-1111-1111-111111111111",
    domain: "tailspin-demo.com",
    userPrefix: "ts",
    spendHistory: synthHistory(24500, 3),
    spendHistorySource: "Synthetic demo series",
    skus: [
      { skuPartNumber: "SPE_E5", purchased: 30, assigned: 22 },
      { skuPartNumber: "SPE_E3", purchased: 95, assigned: 81 },
      { skuPartNumber: "SPB", purchased: 40, assigned: 34 },
      { skuPartNumber: "O365_BUSINESS_PREMIUM", purchased: 25, assigned: 25 },
      { skuPartNumber: "SPE_F1", purchased: 120, assigned: 96 },
      { skuPartNumber: "EXCHANGEENTERPRISE", purchased: 6, assigned: 4 },
      { skuPartNumber: "Microsoft_365_Copilot", purchased: 5, assigned: 2 },
      { skuPartNumber: "PBI_PREMIUM_PER_USER", purchased: 8, assigned: 5 },
      { skuPartNumber: "VISIOCLIENT", purchased: 5, assigned: 3 },
      { skuPartNumber: "POWER_BI_PRO", purchased: 10, assigned: 9 },
      { skuPartNumber: "INTUNE_A", purchased: 60, assigned: 41 },
      { skuPartNumber: "INTUNE_A_D", purchased: 50, assigned: 0 },
      { skuPartNumber: "EXCHANGESTANDARD", purchased: 12, assigned: 9, channel: "csp", term: "P1M" },
      { skuPartNumber: "Microsoft_Teams_Premium", purchased: 25, assigned: 3, trial: true },
      { skuPartNumber: "FLOW_FREE", purchased: 10000, assigned: 212 },
      { skuPartNumber: "POWER_BI_STANDARD", purchased: 1000000, assigned: 340 },
    ],
  },
  {
    id: "contoso",
    name: "Contoso Logistics (demo)",
    tenantId: "22222222-2222-2222-2222-222222222222",
    domain: "contoso-demo.com",
    userPrefix: "co",
    spendHistory: synthHistory(9800, 7),
    spendHistorySource: "Synthetic demo series",
    skus: [
      { skuPartNumber: "SPE_E3", purchased: 60, assigned: 52 },
      { skuPartNumber: "SPE_E5", purchased: 12, assigned: 12 },
      { skuPartNumber: "SPE_F1", purchased: 70, assigned: 41 },
      { skuPartNumber: "EXCHANGEENTERPRISE", purchased: 10, assigned: 6 },
      { skuPartNumber: "TEAMS_EXPLORATORY", purchased: 100, assigned: 14 },
    ],
  },
  {
    id: "fabrikam",
    name: "Fabrikam Freight (demo)",
    tenantId: "33333333-3333-3333-3333-333333333333",
    domain: "fabrikam-demo.com",
    userPrefix: "fb",
    spendHistory: synthHistory(4100, 21),
    spendHistorySource: "Synthetic demo series",
    skus: [
      { skuPartNumber: "SPB", purchased: 85, assigned: 70 },
      { skuPartNumber: "O365_BUSINESS_ESSENTIALS", purchased: 40, assigned: 38 },
      { skuPartNumber: "VISIOCLIENT", purchased: 4, assigned: 1 },
      { skuPartNumber: "FLOW_FREE", purchased: 10000, assigned: 33 },
    ],
  },
];

const FIRST = ["Alex", "Jordan", "Sam", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Avery", "Quinn", "Drew", "Robin", "Kai", "Logan", "Rowan", "Parker"];
const LAST = ["Chen", "Singh", "Martin", "Nguyen", "Lee", "Patel", "Wong", "Brown", "Tremblay", "Garcia", "Kim", "Roy", "Li", "Wilson", "Das", "Hughes"];
const DEPTS = ["Operations", "Finance", "Sales", "IT", "HR", "Customer Service", "Warehouse", "Dispatch"];

/** Generates users so that per-SKU assigned counts match the inventory. */
export function mockUsers(t: MockTenant): UserActivity[] {
  const rng = mulberry32(t.tenantId.charCodeAt(0) * 97);
  const now = Date.now();
  const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString().slice(0, 10);
  const base = ["SPE_E5", "SPE_E3", "Microsoft_365_E3_(no_Teams)", "SPB", "O365_BUSINESS_PREMIUM", "O365_BUSINESS_ESSENTIALS", "SPE_F1"];
  const users: UserActivity[] = [];
  let n = 0;

  for (const sku of t.skus.filter((s) => base.includes(s.skuPartNumber))) {
    for (let i = 0; i < sku.assigned; i++) {
      n++;
      const r = rng();
      // ~12% fully inactive, ~18% mail/Teams only, rest normal
      const profile = r < 0.12 ? "inactive" : r < 0.3 ? "light" : "normal";
      const recent = () => daysAgo(Math.floor(rng() * 20));
      const stale = () => (rng() < 0.4 ? null : daysAgo(95 + Math.floor(rng() * 200)));
      const fn = FIRST[Math.floor(rng() * FIRST.length)];
      const ln = LAST[Math.floor(rng() * LAST.length)];
      users.push({
        id: `${t.userPrefix}-${n}`,
        displayName: `${fn} ${ln}`,
        userPrincipalName: `${fn}.${ln}${n}@${t.domain}`.toLowerCase(),
        department: DEPTS[Math.floor(rng() * DEPTS.length)],
        accountEnabled: !(profile === "inactive" && rng() < 0.35),
        skuPartNumbers: [sku.skuPartNumber],
        groupAssignedSkus: rng() < 0.15 ? [sku.skuPartNumber] : [],
        lastExchange: profile === "inactive" ? stale() : recent(),
        lastTeams: profile === "inactive" ? stale() : recent(),
        lastOneDrive: profile === "normal" ? recent() : stale(),
        lastSharePoint: profile === "normal" ? recent() : stale(),
      });
    }
  }

  // Spread add-ons across users (paid add-ons only; free SKUs are not per-user here)
  for (const sku of t.skus.filter((s) => !base.includes(s.skuPartNumber) && s.purchased < 1000)) {
    for (let i = 0; i < sku.assigned && i < users.length; i++) {
      users[(i * 7 + 3) % users.length].skuPartNumbers.push(sku.skuPartNumber);
    }
  }
  return users;
}

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FREE = new Set(["FLOW_FREE", "POWER_BI_STANDARD", "TEAMS_EXPLORATORY", "WINDOWS_STORE"]);

/** Deterministic subscriptions with renewal dates spread over the next year. */
export function mockSubscriptions(t: MockTenant): SkuSubscription[] {
  const day = 86_400_000;
  const now = Date.now();
  const out: SkuSubscription[] = [];
  t.skus.forEach((s, i) => {
    // Bigger SKUs are split across two purchases with different anniversaries
    const parts = s.purchased >= 40 && !FREE.has(s.skuPartNumber) ? [Math.ceil(s.purchased * 0.7), Math.floor(s.purchased * 0.3)] : [s.purchased];
    parts.forEach((qty, j) => {
      // Demo anchors: E5 (#0) renewed 5 days ago (window open, "+5" reminder due), Business Premium (#2) renews in 15 days ("-15" due)
      const offsetDays = s.term === "P1M" ? 9 : s.trial ? 21 : i === 0 && j === 0 ? -5 : i === 2 && j === 0 ? 15 : ((i * 47 + j * 133) % 330) + 20;
      const next = new Date(now + (offsetDays < 0 ? offsetDays + 365 : offsetDays) * day);
      out.push({
        id: `${t.id}-sub-${i}-${j}`,
        commerceSubscriptionId: `${t.tenantId.slice(0, 8)}-0000-4000-8000-${String(i * 10 + j).padStart(12, "0")}`,
        skuId: `mock-sku-${i}`,
        skuPartNumber: s.skuPartNumber,
        status: "Enabled",
        isTrial: !!s.trial,
        totalLicenses: qty,
        createdDateTime: new Date(now - 400 * day).toISOString(),
        nextLifecycleDateTime: FREE.has(s.skuPartNumber) ? null : next.toISOString(),
      });
    });
  });
  return out;
}

/** Mock MCA billing view for the subscriptions that are billed directly (not CSP, not trial/free). */
export function mockBilling(t: MockTenant, subs: SkuSubscription[]): BillingSubscription[] {
  const day = 86_400_000;
  const meta = new Map(t.skus.map((s) => [s.skuPartNumber, s]));
  return subs
    .filter((s) => !s.isTrial && s.nextLifecycleDateTime && meta.get(s.skuPartNumber)?.channel !== "csp")
    .map((s) => {
      const m = meta.get(s.skuPartNumber)!;
      const termEnd = new Date(s.nextLifecycleDateTime as string);
      const termStart = new Date(termEnd.getTime() - (m.term === "P1M" ? 30 : 365) * day);
      const windowEnd = new Date(termStart.getTime() + 7 * day);
      return {
        billingAccountName: "mock-mca:0000_2019-05-31",
        // Real billing names differ from Graph ids; mimic that so the matcher is exercised
        name: `b-${(s.commerceSubscriptionId as string).slice(9)}`,
        displayName: lookupPrice(s.skuPartNumber).displayName,
        productType: lookupPrice(s.skuPartNumber).displayName,
        provisioningTenantId: t.tenantId,
        purchaseDate: termStart.toISOString(),
        quantity: s.totalLicenses,
        autoRenew: "On" as const,
        status: "Active",
        termStartDate: termStart.toISOString(),
        termEndDate: termEnd.toISOString(),
        termDuration: m.term ?? "P1Y",
        billingFrequency: m.term === "P1M" ? "P1M" : "P1M",
        renewalQuantity: s.totalLicenses,
        cancellation: (Date.now() <= windowEnd.getTime() ? "Allowed" : "NotAllowed") as "Allowed" | "NotAllowed",
        cancellationAllowedEndDate: windowEnd.toISOString(),
      };
    });
}
