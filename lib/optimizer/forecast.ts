import type { SeatPlan } from "@/lib/optimizer/seats";

/**
 * 12-month cost forecast (accrual view: monthly cost of the seats you hold, whatever the
 * billing frequency) under two scenarios:
 *   asIs       every subscription renews at today's quantity (unless auto-renew is already Off)
 *   optimized  each subscription is cut to its target quantity in the 7-day window after its
 *              next renewal (or now, if that window is open today); savings start the month after.
 *              Target 0 = let it lapse.
 */
export interface ForecastRow {
  skuPartNumber: string;
  skuName: string;
  subscriptionId: string;
  channel: "mca" | "csp-or-other" | "unknown";
  renewal: string | null;
  currentQty: number;
  targetQty: number;
  unit: number;
  monthlyBefore: number;
  monthlyAfter: number;
  firstSavingMonth: string | null;
  savings12: number;
  autoRenewOff: boolean;
}

export interface ForecastMonth {
  month: string; // YYYY-MM
  asIs: number;
  optimized: number;
}

const ym = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export function buildForecast(plans: SeatPlan[], start = new Date(), months = 12) {
  const keys: string[] = [];
  for (let i = 0; i < months; i++) keys.push(ym(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1))));
  const totals = new Map(keys.map((k) => [k, { asIs: 0, optimized: 0 }]));
  const rows: ForecastRow[] = [];

  for (const p of plans) {
    if (p.sku.isFree || p.sku.isTrial) continue;
    const unit = p.sku.unitPriceMonthly;
    if (unit <= 0) continue;
    for (const s of p.subs) {
      // If the post-renewal reduction window is open right now, the cut can happen this month.
      // A renewal date in the past with the window closed (Graph not rolled forward yet) means
      // the next chance to cut is one term later.
      let renewalDate = s.renewal ? new Date(s.renewal) : null;
      if (renewalDate && renewalDate.getTime() < Date.now() && !s.windowOpen) {
        const monthly = s.billing?.termDuration === "P1M";
        renewalDate = new Date(Date.UTC(renewalDate.getUTCFullYear() + (monthly ? 0 : 1), renewalDate.getUTCMonth() + (monthly ? 1 : 0), renewalDate.getUTCDate()));
      }
      const renewalKey = renewalDate ? ym(renewalDate) : null;
      const cutKey = s.windowOpen ? keys[0] : renewalKey;
      const autoRenewOff = s.billing?.autoRenew === "Off";
      let savings12 = 0;
      let firstSaving: string | null = null;
      for (const k of keys) {
        const lapsed = autoRenewOff && renewalKey !== null && k > renewalKey;
        const afterCut = cutKey !== null && k > cutKey;
        const asIsQty = lapsed ? 0 : s.currentQty;
        const optQty = lapsed ? 0 : afterCut ? s.targetQty : s.currentQty;
        const t = totals.get(k)!;
        t.asIs += asIsQty * unit;
        t.optimized += optQty * unit;
        const diff = (asIsQty - optQty) * unit;
        if (diff > 0 && !firstSaving) firstSaving = k;
        savings12 += diff;
      }
      rows.push({
        skuPartNumber: p.sku.skuPartNumber,
        skuName: p.sku.displayName,
        subscriptionId: s.sub.commerceSubscriptionId ?? s.sub.id,
        channel: s.channel,
        renewal: s.renewal,
        currentQty: s.currentQty,
        targetQty: s.targetQty,
        unit,
        monthlyBefore: round(s.currentQty * unit),
        monthlyAfter: round(s.targetQty * unit),
        firstSavingMonth: firstSaving,
        savings12: round(savings12),
        autoRenewOff,
      });
    }
  }

  const series: ForecastMonth[] = keys.map((k) => ({ month: k, asIs: round(totals.get(k)!.asIs), optimized: round(totals.get(k)!.optimized) }));
  rows.sort((a, b) => b.savings12 - a.savings12 || (a.renewal ?? "").localeCompare(b.renewal ?? ""));
  return {
    series,
    rows,
    total12AsIs: round(series.reduce((a, m) => a + m.asIs, 0)),
    total12Optimized: round(series.reduce((a, m) => a + m.optimized, 0)),
  };
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
