import { Info } from "lucide-react";
import { Card, PageHeader } from "@/components/dashboard/PageHeader";
import { RecommendationList } from "@/components/dashboard/RecommendationList";
import { config } from "@/lib/config";
import { getRecommendations, listTenants } from "@/lib/data/service";
import { money } from "@/lib/format";

export default async function OptimizationPage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant } = await searchParams;
  const tenants = listTenants();
  const list = tenant && tenants.some((t) => t.id === tenant) ? tenants.filter((t) => t.id === tenant) : tenants;
  const results = await Promise.all(list.map(async (t) => ({ t, recs: await getRecommendations(t.id) })));

  return (
    <>
      <PageHeader title="Cost optimization" subtitle={`Rule engine · inactivity threshold ${config.inactivityDays} days`} />
      <div className="mb-6 flex gap-2 rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink-2">
        <Info size={16} className="mt-0.5 shrink-0 text-accent" />
        <span>
          Savings are realized only when the seat count is reduced on the subscription. Under NCE annual terms that happens at renewal, so
          reclaim licenses first, then lower the quantity before the term rolls over. Usage reports cannot see every premium feature (for
          example Defender P2, Teams Phone, Power BI); confirm before downgrading.
        </span>
      </div>
      {results.map(({ t, recs }) => (
        <Card
          key={t.id}
          className="mb-6"
          title={t.name}
          subtitle={`${recs.length} recommendations · up to ${money(recs.reduce((a, r) => a + r.monthlySavings, 0), config.currency)}/mo`}
        >
          <RecommendationList items={recs} currency={config.currency} />
        </Card>
      ))}
    </>
  );
}
