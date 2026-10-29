"use client";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money } from "@/lib/format";
import type { ForecastMonth } from "@/lib/optimizer/forecast";
import { ChartTooltip } from "./ChartTooltip";
import { useChartColors } from "./useChartColors";

const label = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("en-CA", { month: "short", year: "2-digit" });
};

/** Two series on one axis: as-is run-rate vs. cutting idle seats at each renewal. */
export function ForecastChart({ data, currency }: { data: ForecastMonth[]; currency: string }) {
  const c = useChartColors();
  const rows = data.map((d) => ({ ...d, label: label(d.month) }));
  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: c["series-2"] }} />As is (auto-renew at current seats)</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: c["series-1"] }} />Idle seats cut at renewal</span>
      </div>
      <div className="h-72" role="img" aria-label="Monthly license cost forecast, as-is versus optimized">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: c["text-3"], fontSize: 11 }} />
            <YAxis tickLine={false} axisLine={false} width={60} tick={{ fill: c["text-3"], fontSize: 11 }} tickFormatter={(v: number) => money(v, currency, true)} domain={["auto", "auto"]} />
            <Tooltip
              cursor={{ stroke: c["text-3"], strokeWidth: 1 }}
              content={({ active, payload, label: l }) => {
                const p = payload ?? [];
                const asIs = Number(p.find((x) => x.dataKey === "asIs")?.value ?? 0);
                const opt = Number(p.find((x) => x.dataKey === "optimized")?.value ?? 0);
                return (
                  <ChartTooltip
                    active={active}
                    label={l as string}
                    rows={
                      p.length
                        ? [
                            { name: "As is", value: money(asIs, currency), color: c["series-2"] },
                            { name: "Optimized", value: money(opt, currency), color: c["series-1"] },
                            { name: "Saving", value: money(asIs - opt, currency), color: "transparent" },
                          ]
                        : []
                    }
                  />
                );
              }}
            />
            <Line type="stepAfter" dataKey="asIs" stroke={c["series-2"]} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }} />
            <Line type="stepAfter" dataKey="optimized" stroke={c["series-1"]} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
