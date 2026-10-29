import { ChevronRight, CircleDollarSign, Gift, Layers, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { money, num } from "@/lib/format";
import type { LicenseSku } from "@/lib/types";
import { UtilizationMeter } from "./UtilizationMeter";

const SOURCE_LABEL: Record<string, string> = {
  invoice: "Invoice",
  estimate: "Estimate",
  override: "Override",
  free: "Free",
};

export function fmtDate(d?: string | null) {
  if (!d) return "-";
  // Renewal dates are calendar dates at 00:00Z: format in UTC so every viewer sees the same day
  return new Date(d).toLocaleDateString("en-CA", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
}

export function daysUntil(d?: string | null) {
  if (!d) return null;
  return Math.ceil((Date.parse(d) - Date.now()) / 86_400_000);
}

export function LicenseTable({
  skus,
  currency,
  tenantId,
  compact = false,
}: {
  skus: LicenseSku[];
  currency: string;
  tenantId: string;
  compact?: boolean;
}) {
  const rows = [...skus].sort((a, b) => b.wastedMonthly - a.wastedMonthly || b.monthlyCost - a.monthlyCost);
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
            <th className="px-5 py-2 font-medium">SKU</th>
            <th className="px-3 py-2 text-right font-medium">Purchased</th>
            <th className="px-3 py-2 text-right font-medium">Assigned</th>
            <th className="px-3 py-2 text-right font-medium">Unassigned</th>
            <th className="px-3 py-2 font-medium">Utilization</th>
            <th className="px-3 py-2 font-medium">Next renewal</th>
            <th className="px-3 py-2 text-right font-medium">Unit / mo</th>
            {!compact && <th className="px-3 py-2 text-right font-medium">Cost / mo</th>}
            <th className="px-5 py-2 text-right font-medium">Idle spend / mo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const wasteful = s.wastedMonthly > 0;
            const d = daysUntil(s.nextRenewal);
            return (
              <tr key={s.skuId} className="border-b border-line last:border-0 hover:bg-surface-2/60">
                <td className="px-5 py-3">
                  <Link
                    href={`/licenses/${encodeURIComponent(s.skuPartNumber)}?tenant=${encodeURIComponent(tenantId)}`}
                    className="group inline-flex items-center gap-1 font-medium text-ink hover:text-accent"
                  >
                    {s.displayName}
                    <ChevronRight size={14} className="text-ink-3 group-hover:text-accent" />
                  </Link>
                  <div className="flex items-center gap-2 text-xs text-ink-3">
                    {s.skuPartNumber}
                    {s.isPool && (
                      <span className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-2" title="Tenant-wide pool: Microsoft never counts these as assigned, so unassigned is not idle.">
                        <Layers size={11} /> Tenant pool
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{s.isFree ? "Unlimited" : num(s.purchased)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{s.isPool ? "n/a" : num(s.assigned)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{s.isFree || s.isPool ? "n/a" : num(s.unassigned)}</td>
                <td className="px-3 py-3">
                  <UtilizationMeter assigned={s.assigned} purchased={s.purchased} free={s.isFree || s.isPool} />
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  {s.nextRenewal ? (
                    <span className={d !== null && d <= 30 ? "font-medium text-serious" : "text-ink-2"} title={d !== null ? `${d} days` : undefined}>
                      {fmtDate(s.nextRenewal)}
                    </span>
                  ) : (
                    <span className="text-ink-3">-</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {s.isFree ? (
                    <span className="inline-flex items-center gap-1 text-ink-3"><Gift size={13} /> Free</span>
                  ) : (
                    <span title={`Price source: ${SOURCE_LABEL[s.priceSource]}`}>
                      {money(s.unitPriceMonthly, currency)}
                      {s.priceSource === "estimate" && <span className="ml-1 text-xs text-ink-3">est.</span>}
                    </span>
                  )}
                </td>
                {!compact && <td className="px-3 py-3 text-right tabular-nums">{s.isFree ? "-" : money(s.monthlyCost, currency)}</td>}
                <td className="px-5 py-3 text-right tabular-nums">
                  {wasteful ? (
                    <span className="inline-flex items-center gap-1 font-medium text-critical">
                      <TriangleAlert size={13} aria-label="Wasted spend" /> {money(s.wastedMonthly, currency)}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-ink-3"><CircleDollarSign size={13} /> None</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
