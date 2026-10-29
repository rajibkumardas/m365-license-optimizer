"use client";

export function ChartTooltip({
  active,
  label,
  rows,
}: {
  active?: boolean;
  label?: string;
  rows: { name: string; value: string; color: string }[];
}) {
  if (!active || !rows.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      {label && <div className="mb-1 font-medium text-ink">{label}</div>}
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2 text-ink-2">
          <span className="h-2 w-2 rounded-sm" style={{ background: r.color }} />
          <span>{r.name}</span>
          <span className="ml-auto pl-4 font-medium tabular-nums text-ink">{r.value}</span>
        </div>
      ))}
    </div>
  );
}
