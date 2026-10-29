import { EyeOff } from "lucide-react";
import Link from "next/link";
import { LicenseTable } from "@/components/dashboard/LicenseTable";
import { Card, PageHeader } from "@/components/dashboard/PageHeader";
import { Warnings } from "@/components/dashboard/Warnings";
import { config } from "@/lib/config";
import { getTenantSnapshot, listTenants } from "@/lib/data/service";
import { money } from "@/lib/format";

export default async function LicensesPage({ searchParams }: { searchParams: Promise<{ tenant?: string; show?: string }> }) {
  const { tenant, show } = await searchParams;
  const showAll = show === "all";
  const tenants = listTenants();
  const ids = tenant && tenants.some((t) => t.id === tenant) ? [tenant] : tenants.map((t) => t.id);
  const snaps = await Promise.all(ids.map((id) => getTenantSnapshot(id)));
  const toggleHref = `/licenses?${new URLSearchParams({ ...(tenant ? { tenant } : {}), ...(showAll ? {} : { show: "all" }) })}`;

  return (
    <>
      <PageHeader
        title="License inventory & cost"
        subtitle="Click a SKU for its subscriptions, renewal dates, idle seats and actions. Red = paid seats nobody is using."
      >
        <Link href={toggleHref} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink-2 hover:text-ink">
          <EyeOff size={13} /> {showAll ? "Hide free & trial SKUs" : "Show free & trial SKUs"}
        </Link>
      </PageHeader>
      {snaps.map((snap) => {
        const hidden = snap.skus.filter((s) => s.isFree || s.isTrial);
        const visible = showAll ? snap.skus : snap.skus.filter((s) => !s.isFree && !s.isTrial);
        const waste = visible.reduce((a, s) => a + s.wastedMonthly, 0);
        return (
          <div key={snap.tenant.id} className="mb-8">
            <Warnings items={snap.warnings} />
            <Card
              title={snap.tenant.name}
              subtitle={`${visible.length} SKUs shown${!showAll && hidden.length ? ` · ${hidden.length} free/trial hidden` : ""} · idle ${money(waste, config.currency)}/mo`}
            >
              <LicenseTable skus={visible} currency={config.currency} tenantId={snap.tenant.id} />
            </Card>
          </div>
        );
      })}
    </>
  );
}
