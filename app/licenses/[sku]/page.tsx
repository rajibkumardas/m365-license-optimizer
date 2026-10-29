import { ArrowLeft, CalendarClock, CircleDollarSign, ExternalLink, Layers, PackageOpen, UserMinus, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BillingSessionButton } from "@/components/dashboard/BillingSessionButton";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { fmtDate } from "@/components/dashboard/LicenseTable";
import { Card, PageHeader } from "@/components/dashboard/PageHeader";
import { ReclaimUsers, SubscriptionActions } from "@/components/dashboard/SkuActions";
import { Warnings } from "@/components/dashboard/Warnings";
import { getPrincipal } from "@/lib/auth";
import { config } from "@/lib/config";
import { getBillingView, getTenantSnapshot, listTenants } from "@/lib/data/service";
import { money, num } from "@/lib/format";
import { activeSubs, buildSeatPlan } from "@/lib/optimizer/seats";
import { getReminderSettings } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function SkuPage({
  params,
  searchParams,
}: {
  params: Promise<{ sku: string }>;
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { sku: skuParam } = await params;
  const { tenant } = await searchParams;
  const tenants = listTenants();
  const tenantId = tenant && tenants.some((t) => t.id === tenant) ? tenant : tenants[0]?.id;
  if (!tenantId) notFound();

  const [snap, billing, me, settings] = await Promise.all([
    getTenantSnapshot(tenantId),
    getBillingView(tenantId),
    getPrincipal(),
    getReminderSettings(),
  ]);
  const sku = snap.skus.find((s) => s.skuPartNumber === decodeURIComponent(skuParam));
  if (!sku) notFound();
  const plan = buildSeatPlan(snap, sku, billing.items, { inactivityDays: config.inactivityDays, seatBuffer: settings.seatBuffer });
  const cur = config.currency;
  const removable = plan.reclaimable.filter((u) => !u.viaGroup).length;

  return (
    <>
      <Link href={`/licenses?tenant=${tenantId}`} className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft size={14} /> License inventory
      </Link>
      <PageHeader title={sku.displayName} subtitle={`${sku.skuPartNumber} · ${snap.tenant.name} · ${money(sku.unitPriceMonthly, cur)} per seat / month${sku.priceSource === "estimate" ? " (estimate)" : ""}`}>
        <a
          href="https://admin.microsoft.com/#/subscriptions"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink-2 hover:text-ink"
        >
          Open in M365 admin center <ExternalLink size={12} />
        </a>
      </PageHeader>

      {sku.isPool && (
        <div className="mb-6 flex gap-2 rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink-2">
          <Layers size={16} className="mt-0.5 shrink-0 text-accent" />
          <span>
            This is a tenant-wide pool. Microsoft never assigns it to users or devices and never counts it as consumed, so the app does not treat
            unassigned seats as idle and offers no reduction. Size it against the number of shared or userless devices instead.
          </span>
        </div>
      )}
      {billing.status !== "ok" && (
        <div className="mb-6">
          <Warnings items={[billing.message]} />
          {billing.status === "no-token" && <BillingSessionButton />}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Purchased / assigned" value={`${num(sku.purchased)} / ${sku.isPool ? "n/a" : num(sku.assigned)}`} hint={`${num(sku.unassigned)} unassigned`} icon={Users} />
        <KpiCard label="Licenses to reclaim" value={num(plan.reclaimable.length)} hint={`${removable} removable here · ${plan.reclaimable.length - removable} via group`} icon={UserMinus} tone={plan.reclaimable.length ? "waste" : "neutral"} />
        <KpiCard label="Seats needed" value={num(plan.neededSeats)} hint={`Assigned minus reclaimable${settings.seatBuffer ? ` + ${settings.seatBuffer} buffer` : ""}`} icon={PackageOpen} />
        <KpiCard label="Savings if cut at renewal" value={`${money(plan.monthlySavings, cur)}/mo`} hint={`${num(plan.idleSeats)} seats · ${money(plan.monthlySavings * 12, cur)}/yr`} icon={CircleDollarSign} tone="savings" />
      </div>

      <Card
        className="mt-6"
        title="Subscriptions & renewal dates"
        subtitle="MCA rule: seats can only be removed within 7 days after a purchase or renewal. Before renewal you can only turn auto-renew off (the whole subscription then lapses)."
      >
        <SubscriptionActions
          tenant={tenantId}
          skuPartNumber={sku.skuPartNumber}
          currency={cur}
          unit={sku.unitPriceMonthly}
          isAdmin={me.isAdmin}
          mock={config.dataMode !== "live"}
          rows={plan.subs.map((s) => ({
            // Same floor the server enforces: other ACTIVE, paid subscriptions of this SKU
            minQty: Math.max(
              0,
              sku.assigned -
                activeSubs(snap, sku.skuPartNumber)
                  .filter((o) => o.id !== s.sub.id)
                  .reduce((a, o) => a + o.totalLicenses, 0),
            ),
            id: s.sub.commerceSubscriptionId ?? s.sub.id,
            label: `${s.billing?.productType ?? sku.displayName}${s.billing?.termDuration === "P1M" ? " (monthly)" : s.billing?.termDuration === "P1Y" ? " (annual)" : ""}`,
            purchased: s.billing?.purchaseDate ?? s.sub.createdDateTime ?? null,
            billingName: s.billing?.name ?? null,
            channel: s.channel,
            isTrial: s.sub.isTrial,
            status: s.billing?.status ?? s.sub.status,
            currentQty: s.currentQty,
            targetQty: s.targetQty,
            cut: s.cut,
            renewal: s.renewal,
            term: s.billing?.termDuration ?? null,
            autoRenew: s.billing?.autoRenew ?? null,
            windowOpen: s.windowOpen,
            windowEndsAt: s.windowEndsAt,
          }))}
          disabled={sku.isPool || sku.isFree}
        />
      </Card>

      <Card
        className="mt-6"
        title={`Licenses held by disabled or inactive users (${plan.reclaimable.length})`}
        subtitle={`No Exchange, OneDrive, SharePoint or Teams activity in ${config.inactivityDays}+ days, or sign-in blocked. Removing them lowers "assigned", which is what lets you cut seats at renewal.`}
        action={
          <span className="inline-flex items-center gap-1 text-xs text-ink-3">
            <CalendarClock size={13} /> Next renewal {fmtDate(sku.nextRenewal)}
          </span>
        }
      >
        <ReclaimUsers
          tenant={tenantId}
          skuPartNumber={sku.skuPartNumber}
          isAdmin={me.isAdmin}
          mock={config.dataMode !== "live"}
          users={plan.reclaimable}
        />
      </Card>
    </>
  );
}
