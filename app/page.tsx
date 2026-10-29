import { CalendarRange, CircleDollarSign, PiggyBank, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { LicenseTable } from "@/components/dashboard/LicenseTable";
import { Card, PageHeader } from "@/components/dashboard/PageHeader";
import { RecommendationList } from "@/components/dashboard/RecommendationList";
import { SpendTrendChart } from "@/components/dashboard/SpendTrendChart";
import { TenantBreakdownChart } from "@/components/dashboard/TenantBreakdownChart";
import { UtilizationMeter } from "@/components/dashboard/UtilizationMeter";
import { Warnings } from "@/components/dashboard/Warnings";
import { config } from "@/lib/config";
import { getAllSummaries, getRecommendations, getTenantSnapshot, listTenants, summarize } from "@/lib/data/service";
import { money, pct } from "@/lib/format";
import type { MonthlySpend } from "@/lib/types";

type SP = Promise<{ tenant?: string }>;

export default async function OverviewPage({ searchParams }: { searchParams: SP }) {
  const { tenant } = await searchParams;
  const cur = config.currency;
  const tenants = listTenants();
  if (!tenants.length) return <NotConfigured />;

  if (tenant && tenants.some((t) => t.id === tenant)) {
    const [snap, recs] = await Promise.all([getTenantSnapshot(tenant), getRecommendations(tenant)]);
    const s = summarize(snap, recs);
    return (
      <>
        <PageHeader title={snap.tenant.name} subtitle={`Tenant ${snap.tenant.tenantId} · refreshed ${new Date(snap.generatedAt).toLocaleString("en-CA")}`} />
        <Warnings items={snap.warnings} />
        <Kpis monthly={s.monthlyCost} wasted={s.wastedMonthly} savings={s.potentialSavings} assigned={s.assigned} purchased={s.purchased} currency={cur} />
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-3" title="Monthly invoiced spend" subtitle={snap.spendHistorySource}>
            <SpendTrendChart data={snap.spendHistory} currency={cur} />
          </Card>
          <Card
            className="lg:col-span-2"
            title="Top savings opportunities"
            action={<Link href={`/optimization?tenant=${tenant}`} className="text-xs font-medium text-accent hover:underline">View all</Link>}
          >
            <RecommendationList items={recs} currency={cur} limit={4} />
          </Card>
        </div>
        <Card className="mt-6" title="License inventory" subtitle="Sorted by idle spend">
          <LicenseTable skus={snap.skus.filter((s) => !s.isFree && !s.isTrial)} currency={cur} tenantId={snap.tenant.id} compact />
        </Card>
      </>
    );
  }

  const { summaries, errors } = await getAllSummaries();
  const total = summaries.reduce(
    (a, s) => ({
      monthly: a.monthly + s.monthlyCost,
      wasted: a.wasted + s.wastedMonthly,
      savings: a.savings + s.potentialSavings,
      assigned: a.assigned + s.assigned,
      purchased: a.purchased + s.purchased,
    }),
    { monthly: 0, wasted: 0, savings: 0, assigned: 0, purchased: 0 },
  );

  // Combined invoice trend across tenants that have history
  const snaps = await Promise.all(summaries.map((s) => getTenantSnapshot(s.id)));
  const byMonth = new Map<string, number>();
  for (const sn of snaps) for (const m of sn.spendHistory) byMonth.set(m.month, (byMonth.get(m.month) ?? 0) + m.amount);
  const combined: MonthlySpend[] = [...byMonth.entries()].sort().map(([month, amount]) => ({ month, amount: Math.round(amount) }));

  return (
    <>
      <PageHeader title="All tenants" subtitle={`${summaries.length} connected tenant(s) · license run-rate from current seat counts × price book`} />
      <Warnings items={errors} />
      <Kpis monthly={total.monthly} wasted={total.wasted} savings={total.savings} assigned={total.assigned} purchased={total.purchased} currency={cur} />
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2" title="Monthly cost by tenant" subtitle="Run-rate, in use vs idle">
          <TenantBreakdownChart data={summaries} currency={cur} />
        </Card>
        <Card className="lg:col-span-3" title="Invoiced spend, all tenants" subtitle="Sum of tenants with invoice history connected">
          <SpendTrendChart data={combined} currency={cur} />
        </Card>
      </div>
      <Card className="mt-6" title="Tenant breakdown">
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
                <th className="px-5 py-2 font-medium">Tenant</th>
                <th className="px-3 py-2 text-right font-medium">Monthly</th>
                <th className="px-3 py-2 text-right font-medium">Annual</th>
                <th className="px-3 py-2 font-medium">Seat utilization</th>
                <th className="px-3 py-2 text-right font-medium">Idle / mo</th>
                <th className="px-5 py-2 text-right font-medium">Potential savings / mo</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((s) => (
                <tr key={s.id} className="border-b border-line last:border-0 hover:bg-surface-2/60">
                  <td className="px-5 py-3">
                    <Link href={`/?tenant=${s.id}`} className="font-medium text-ink hover:text-accent">{s.name}</Link>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{money(s.monthlyCost, cur)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{money(s.monthlyCost * 12, cur)}</td>
                  <td className="px-3 py-3"><UtilizationMeter assigned={s.assigned} purchased={s.purchased} /></td>
                  <td className="px-3 py-3 text-right tabular-nums text-critical">{money(s.wastedMonthly, cur)}</td>
                  <td className="px-5 py-3 text-right font-medium tabular-nums text-good">{money(s.potentialSavings, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function Kpis({ monthly, wasted, savings, assigned, purchased, currency }: { monthly: number; wasted: number; savings: number; assigned: number; purchased: number; currency: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Monthly license spend" value={money(monthly, currency)} hint="Purchased seats × unit price" icon={CircleDollarSign} />
      <KpiCard label="Annualized spend" value={money(monthly * 12, currency)} hint="Monthly run-rate × 12" icon={CalendarRange} />
      <KpiCard label="Idle spend / month" value={money(wasted, currency)} hint={`${purchased - assigned} paid seats unassigned · ${pct(purchased ? (purchased - assigned) / purchased : 0)} of seats`} icon={TriangleAlert} tone="waste" />
      <KpiCard label="Potential savings / month" value={money(savings, currency)} hint={`${money(savings * 12, currency)} per year if all actions are taken`} icon={PiggyBank} tone="savings" />
    </div>
  );
}

function NotConfigured() {
  return (
    <Card title="No tenants configured">
      <p className="text-sm text-ink-2">
        Set <code>DATA_MODE=mock</code> to explore with demo data, or configure <code>AZURE_TENANT_ID</code>, <code>CLIENT_ID</code> and{" "}
        <code>CLIENT_SECRET</code> (or <code>TENANTS</code>) and set <code>DATA_MODE=live</code>. See Settings.
      </p>
    </Card>
  );
}
