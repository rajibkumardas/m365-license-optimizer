"use client";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money } from "@/lib/format";
import type { MonthlySpend } from "@/lib/types";
import { ChartTooltip } from "./ChartTooltip";
import { useChartColors } from "./useChartColors";

function monthLabel(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("en-CA", { month: "short", year: "2-digit" });
}

export function SpendTrendChart({ data, currency }: { data: MonthlySpend[]; currency: string }) {
  const c = useChartColors();
  if (!data.length) {
    return <div className="flex h-64 items-center justify-center text-sm text-ink-3">No invoice history connected for this tenant.</div>;
  }
  const rows = data.map((d) => ({ ...d, label: monthLabel(d.month) }));
  return (
    <div className="h-64" role="img" aria-label="Monthly invoiced spend trend">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c["series-1"]} stopOpacity={0.22} />
              <stop offset="100%" stopColor={c["series-1"]} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={c.grid} strokeDasharray="0" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: c["text-3"], fontSize: 11 }} interval="preserveStartEnd" minTickGap={16} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={56}
            tick={{ fill: c["text-3"], fontSize: 11 }}
            tickFormatter={(v: number) => money(v, currency, true)}
          />
          <Tooltip
            cursor={{ stroke: c["text-3"], strokeWidth: 1 }}
            content={({ active, payload, label }) => (
              <ChartTooltip
                active={active}
                label={label as string}
                rows={(payload ?? []).map((p) => ({ name: "Invoiced", value: money(Number(p.value), currency), color: c["series-1"] }))}
              />
            )}
          />
          <Area
            type="monotone"
            dataKey="amount"
            stroke={c["series-1"]}
            strokeWidth={2}
            fill="url(#spendFill)"
            activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
