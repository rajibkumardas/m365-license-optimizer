import { CalendarRange, CircleDollarSign, Info, PiggyBank } from "lucide-react";
import Link from "next/link";
import { ForecastChart } from "@/components/dashboard/ForecastChart";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { fmtDate } from "@/components/dashboard/LicenseTable";
import { Card, PageHeader } from "@/components/dashboard/PageHeader";
import { Warnings } from "@/components/dashboard/Warnings";
import { config } from "@/lib/config";
import { getBillingView, getTenantSnapshot, listTenants } from "@/lib/data/service";
import { money } from "@/lib/format";
import { buildForecast } from "@/lib/optimizer/forecast";
import { buildSeatPlan } from "@/lib/optimizer/seats";
import { getReminderSettings } from "@/lib/store";

export const dynamic = "force-dynamic";

const ml = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("en-CA", { month: "short", year: "numeric" });
};

export default async function ForecastPage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant } = await searchParams;
  const tenants = listTenants();
  const ids = tenant && tenants.some((t) => t.id === tenant) ? [tenant] : tenants.map((t) => t.id);
  const settings = await getReminderSettings();
  const cur = config.currency;

  const notes: string[] = [];
  const plans = [];
  const tenantOf = new Map<string, string>();
  for (const id of ids) {
    const [snap, billing] = await Promise.all([getTenantSnapshot(id), getBillingView(id)]);
    if (billing.status !== "ok" && config.dataMode === "live") notes.push(`${snap.tenant.name}: ${billing.message} Using Graph renewal dates; auto-renew status unknown.`);
    for (const sku of snap.skus) {
      if (sku.isFree || sku.isTrial) continue;
      plans.push(buildSeatPlan(snap, sku, billing.items, { inactivityDays: config.inactivityDays, seatBuffer: settings.seatBuffer }));
      tenantOf.set(sku.skuPartNumber, id);
    }
  }
  const f = buildForecast(plans);
  const saving = f.total12AsIs - f.total12Optimized;

  return (
    <>
      <PageHeader title="Cost forecast" subtitle={`Next 12 months by renewal date · ${ids.length > 1 ? "all tenants" : tenants.find((t) => t.id === ids[0])?.name}`} />
      <Warnings items={notes} />
      <div className="mb-6 flex gap-2 rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink-2">
        <Info size={16} className="mt-0.5 shrink-0 text-accent" />
        <span>
          Monthly cost of the seats you hold (accrual view, not invoice timing). The optimized line assumes each subscription is cut to the seats actually needed
          (assigned minus licenses held by disabled or inactive users{settings.seatBuffer ? `, plus a ${settings.seatBuffer}-seat buffer` : ""}) in the 7-day window
          after its next renewal (or now, where that window is open today), so savings start the month after. Subscriptions that need 0 seats are assumed to lapse.
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="12-month cost, as is" value={money(f.total12AsIs, cur)} hint="Everything auto-renews at current seats" icon={CalendarRange} />
        <KpiCard label="12-month cost, optimized" value={money(f.total12Optimized, cur)} hint="Idle seats cut at each renewal" icon={CircleDollarSign} />
        <KpiCard label="12-month saving" value={money(saving, cur)} hint={`${f.total12AsIs ? ((saving / f.total12AsIs) * 100).toFixed(1) : "0"}% of forecast spend`} icon={PiggyBank} tone="savings" />
      </div>
      <Card className="mt-6" title="Monthly forecast">
        <ForecastChart data={f.series} currency={cur} />
      </Card>
      <Card className="mt-6" title="Month by month">
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
                <th className="px-5 py-2 font-medium">Month</th>
                <th className="px-3 py-2 text-right font-medium">As is</th>
                <th className="px-3 py-2 text-right font-medium">Optimized</th>
                <th className="px-5 py-2 text-right font-medium">Saving</th>
              </tr>
            </thead>
            <tbody>
              {f.series.map((m) => (
                <tr key={m.month} className="border-b border-line last:border-0">
                  <td className="px-5 py-2">{ml(m.month)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(m.asIs, cur)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(m.optimized, cur)}</td>
                  <td className="px-5 py-2 text-right tabular-nums text-good">{m.asIs - m.optimized > 0 ? money(m.asIs - m.optimized, cur) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="mt-6" title="By subscription" subtitle="Sorted by 12-month saving. Click a SKU to act on it.">
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
                <th className="px-5 py-2 font-medium">SKU</th>
                <th className="px-3 py-2 font-medium">Next renewal</th>
                <th className="px-3 py-2 font-medium">Billing</th>
                <th className="px-3 py-2 text-right font-medium">Seats now → needed</th>
                <th className="px-3 py-2 text-right font-medium">Monthly now → after</th>
                <th className="px-3 py-2 font-medium">Saving starts</th>
                <th className="px-5 py-2 text-right font-medium">12-mo saving</th>
              </tr>
            </thead>
            <tbody>
              {f.rows.map((r) => (
                <tr key={r.subscriptionId} className="border-b border-line last:border-0">
                  <td className="px-5 py-2">
                    <Link href={`/licenses/${encodeURIComponent(r.skuPartNumber)}?tenant=${tenantOf.get(r.skuPartNumber) ?? ""}`} className="font-medium hover:text-accent">
                      {r.skuName}
                    </Link>
                    <div className="font-mono text-[11px] text-ink-3">{r.subscriptionId}</div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.renewal)}{r.autoRenewOff && <div className="text-xs text-serious">Auto-renew off</div>}</td>
                  <td className="px-3 py-2 text-xs text-ink-2">{r.channel === "mca" ? "MCA" : r.channel === "unknown" ? "Unknown" : "Partner / other"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.currentQty} → <span className={r.targetQty < r.currentQty ? "font-medium text-good" : ""}>{r.targetQty}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {money(r.monthlyBefore, cur)} → {money(r.monthlyAfter, cur)}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.firstSavingMonth ? ml(r.firstSavingMonth) : "-"}</td>
                  <td className="px-5 py-2 text-right font-medium tabular-nums text-good">{r.savings12 > 0 ? money(r.savings12, cur) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
