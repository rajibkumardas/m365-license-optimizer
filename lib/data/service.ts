import "server-only";
import { getArmToken, getPrincipal } from "@/lib/auth";
import { BillingAuthError, listSeatSubscriptions } from "@/lib/billing/client";
import { config, type TenantConfig } from "@/lib/config";
import { getActivityReport, listCompanySubscriptions, listLicensedUsers, listSubscribedSkus } from "@/lib/graph/client";
import { runOptimizer } from "@/lib/optimizer/engine";
import { lookupPrice } from "@/lib/pricing/priceBook";
import type {
  BillingSubscription,
  LicenseSku,
  Recommendation,
  SkuSubscription,
  TenantSnapshot,
  TenantSummary,
  UserActivity,
} from "@/lib/types";
import { MOCK_TENANTS, mockBilling, mockSubscriptions, mockUsers } from "./mock";

const TTL_MS = 15 * 60_000;
const cache = new Map<string, { at: number; snap: TenantSnapshot }>();

export function listTenants(): { id: string; name: string; tenantId: string }[] {
  if (config.dataMode === "mock") return MOCK_TENANTS.map(({ id, name, tenantId }) => ({ id, name, tenantId }));
  return config.tenants.map(({ id, name, tenantId }) => ({ id, name, tenantId }));
}

export function tenantConfig(id: string): TenantConfig {
  const t = config.tenants.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown tenant "${id}"`);
  return t;
}

export function invalidate(id: string) {
  cache.delete(id);
}

function toSku(skuId: string, skuPartNumber: string, purchased: number, assigned: number, subs: SkuSubscription[]): LicenseSku {
  const p = lookupPrice(skuPartNumber);
  const isFree = p.tier === "free" || p.source === "free";
  const mine = subs.filter((s) => s.skuPartNumber === skuPartNumber && s.status !== "Deleted");
  const isTrial = mine.length > 0 && mine.every((s) => s.isTrial);
  const isPool = !!p.pool;
  const unassigned = isPool ? 0 : Math.max(0, purchased - assigned);
  const upcoming = mine
    .map((s) => s.nextLifecycleDateTime)
    .filter((d): d is string => !!d && Date.parse(d) >= Date.now() - 86_400_000)
    .sort();
  return {
    skuId,
    skuPartNumber,
    displayName: p.displayName,
    purchased,
    assigned,
    unassigned,
    unitPriceMonthly: p.monthly,
    priceSource: p.source,
    monthlyCost: isTrial ? 0 : round(purchased * p.monthly),
    wastedMonthly: isFree || isTrial || isPool ? 0 : round(unassigned * p.monthly),
    isFree,
    isTrial,
    isPool,
    tier: p.tier,
    nextRenewal: upcoming[0] ?? null,
  };
}

async function buildLive(t: TenantConfig): Promise<TenantSnapshot> {
  const warnings: string[] = [];
  const [skus, users, activity, subs] = await Promise.all([
    listSubscribedSkus(t),
    listLicensedUsers(t),
    getActivityReport(t).catch((e: Error) => {
      warnings.push(`Usage report unavailable: ${e.message}`);
      return { rows: [], concealed: false };
    }),
    listCompanySubscriptions(t).catch((e: Error) => {
      warnings.push(`Subscription renewal dates unavailable: ${e.message}`);
      return [];
    }),
  ]);
  if (activity.concealed) {
    warnings.push(
      "Usage reports are anonymized. Clear 'Conceal user, group, and site names in all reports' (M365 admin center > Settings > Org settings > Reports) to enable inactive-user detection.",
    );
  }
  const partById = new Map(skus.map((s) => [s.skuId, s.skuPartNumber]));
  const byUpn = new Map(activity.rows.map((r) => [r.upn, r]));

  const mappedUsers: UserActivity[] = users.map((u) => {
    const a = byUpn.get(u.userPrincipalName.toLowerCase());
    return {
      id: u.id,
      displayName: u.displayName,
      userPrincipalName: u.userPrincipalName,
      department: u.department ?? undefined,
      accountEnabled: u.accountEnabled,
      skuPartNumbers: u.assignedLicenses.map((l) => partById.get(l.skuId) ?? l.skuId),
      groupAssignedSkus: (u.licenseAssignmentStates ?? [])
        .filter((s) => s.assignedByGroup)
        .map((s) => partById.get(s.skuId) ?? s.skuId),
      // Missing from the report (new joiner, renamed UPN) or concealed report: activity unknown,
      // so the user is never flagged inactive (disabled accounts are still flagged).
      activityKnown: !!a && !activity.concealed,
      createdDateTime: u.createdDateTime ?? null,
      lastExchange: a?.exchange ?? null,
      lastOneDrive: a?.oneDrive ?? null,
      lastSharePoint: a?.sharePoint ?? null,
      lastTeams: a?.teams ?? null,
    };
  });

  const subscriptions: SkuSubscription[] = subs.map((s) => ({
    id: s.id,
    commerceSubscriptionId: s.commerceSubscriptionId,
    skuId: s.skuId,
    skuPartNumber: s.skuPartNumber,
    status: s.status,
    isTrial: s.isTrial,
    totalLicenses: s.totalLicenses,
    createdDateTime: s.createdDateTime ?? null,
    nextLifecycleDateTime: s.nextLifecycleDateTime ?? null,
  }));

  return {
    tenant: { id: t.id, name: t.name, tenantId: t.tenantId },
    currency: config.currency,
    dataMode: "live",
    generatedAt: new Date().toISOString(),
    skus: skus
      .filter((s) => s.capabilityStatus === "Enabled" || s.capabilityStatus === "Warning")
      .map((s) => toSku(s.skuId, s.skuPartNumber, s.prepaidUnits.enabled, s.consumedUnits, subscriptions)),
    users: mappedUsers,
    spendHistory: [],
    spendHistorySource: "Not connected (Graph exposes no invoice data)",
    subscriptions,
    warnings,
  };
}

function buildMock(id: string): TenantSnapshot {
  const m = MOCK_TENANTS.find((t) => t.id === id) ?? MOCK_TENANTS[0];
  const subscriptions = mockSubscriptions(m);
  return {
    tenant: { id: m.id, name: m.name, tenantId: m.tenantId },
    currency: config.currency,
    dataMode: "mock",
    generatedAt: new Date().toISOString(),
    skus: m.skus.map((s, i) => toSku(`mock-sku-${i}`, s.skuPartNumber, s.purchased, s.assigned, subscriptions)),
    users: mockUsers(m),
    spendHistory: m.spendHistory,
    spendHistorySource: m.spendHistorySource,
    subscriptions,
    warnings: [],
  };
}

export async function getTenantSnapshot(id: string): Promise<TenantSnapshot> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.snap;
  const snap = config.dataMode === "mock" ? buildMock(id) : await buildLive(tenantConfig(id));
  cache.set(id, { at: Date.now(), snap });
  return snap;
}

export async function getRecommendations(id: string): Promise<Recommendation[]> {
  const snap = await getTenantSnapshot(id);
  return runOptimizer(snap, { inactivityDays: config.inactivityDays });
}

export type BillingView =
  | { status: "ok"; items: BillingSubscription[] }
  | { status: "no-token" | "other-tenant" | "no-access" | "error"; items: []; message: string };

/**
 * MCA billing view for a tenant. Live mode needs the signed-in admin's ARM token and only
 * applies to the admin's home tenant (the billing account belongs to that tenant).
 */
export async function getBillingView(id: string): Promise<BillingView> {
  if (config.dataMode === "mock") {
    const m = MOCK_TENANTS.find((t) => t.id === id) ?? MOCK_TENANTS[0];
    return { status: "ok", items: mockBilling(m, (await getTenantSnapshot(id)).subscriptions) };
  }
  const me = await getPrincipal();
  const t = tenantConfig(id);
  if (me.tid && me.tid !== t.tenantId) {
    return { status: "other-tenant", items: [], message: "Billing actions are only available for your home tenant." };
  }
  const { token, expired } = await getArmToken();
  if (!token) {
    return {
      status: "no-token",
      items: [],
      message: expired
        ? "Your billing session expired. Use 'Refresh billing session' to continue."
        : "Billing data needs a fresh sign-in with billing access. Use 'Refresh billing session'.",
    };
  }
  try {
    return { status: "ok", items: await listSeatSubscriptions(token) };
  } catch (e) {
    if (e instanceof BillingAuthError) return { status: "no-access", items: [], message: e.message };
    return { status: "error", items: [], message: (e as Error).message };
  }
}

export function summarize(snap: TenantSnapshot, recs: Recommendation[]): TenantSummary {
  const paid = snap.skus.filter((s) => !s.isFree && !s.isTrial && !s.isPool);
  return {
    id: snap.tenant.id,
    name: snap.tenant.name,
    monthlyCost: round(snap.skus.reduce((a, s) => a + s.monthlyCost, 0)),
    wastedMonthly: round(snap.skus.reduce((a, s) => a + s.wastedMonthly, 0)),
    potentialSavings: round(recs.reduce((a, r) => a + r.monthlySavings, 0)),
    purchased: paid.reduce((a, s) => a + s.purchased, 0),
    assigned: paid.reduce((a, s) => a + s.assigned, 0),
  };
}

export async function getAllSummaries(): Promise<{ summaries: TenantSummary[]; errors: string[] }> {
  const errors: string[] = [];
  const results = await Promise.all(
    listTenants().map(async (t) => {
      try {
        const snap = await getTenantSnapshot(t.id);
        return summarize(snap, runOptimizer(snap, { inactivityDays: config.inactivityDays }));
      } catch (e) {
        errors.push(`${t.name}: ${(e as Error).message}`);
        return null;
      }
    }),
  );
  return { summaries: results.filter((x): x is TenantSummary => x !== null), errors };
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
