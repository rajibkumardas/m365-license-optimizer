"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money } from "@/lib/format";
import type { TenantSummary } from "@/lib/types";
import { ChartTooltip } from "./ChartTooltip";
import { useChartColors } from "./useChartColors";

/** Stacked horizontal bars: in-use spend vs idle (unassigned) spend per tenant. */
export function TenantBreakdownChart({ data, currency }: { data: TenantSummary[]; currency: string }) {
  const c = useChartColors();
  const rows = [...data]
    .sort((a, b) => b.monthlyCost - a.monthlyCost)
    .map((t) => ({ name: t.name, inUse: Math.round(t.monthlyCost - t.wastedMonthly), idle: Math.round(t.wastedMonthly) }));
  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c["series-1"] }} />In use</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c["series-2"] }} />Idle (unassigned)</span>
      </div>
      <div style={{ height: Math.max(120, rows.length * 52) }} role="img" aria-label="Monthly license cost per tenant, in use versus idle">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap={14}>
            <CartesianGrid horizontal={false} stroke={c.grid} />
            <XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: c["text-3"], fontSize: 11 }} tickFormatter={(v: number) => money(v, currency, true)} />
            <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={150} tick={{ fill: c["text-2"], fontSize: 12 }} />
            <Tooltip
              cursor={{ fill: c.grid, opacity: 0.4 }}
              content={({ active, payload, label }) => (
                <ChartTooltip
                  active={active}
                  label={label as string}
                  rows={(payload ?? []).map((p) => ({
                    name: p.dataKey === "inUse" ? "In use" : "Idle",
                    value: money(Number(p.value), currency),
                    color: p.dataKey === "inUse" ? c["series-1"] : c["series-2"],
                  }))}
                />
              )}
            />
            <Bar dataKey="inUse" stackId="a" fill={c["series-1"]} stroke={c.surface} strokeWidth={2} radius={[4, 0, 0, 4]} />
            <Bar dataKey="idle" stackId="a" fill={c["series-2"]} stroke={c.surface} strokeWidth={2} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
