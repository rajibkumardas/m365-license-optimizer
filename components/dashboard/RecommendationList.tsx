"use client";
import { ArrowDownRight, Copy, PackageOpen, UserX, UserMinus, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { cn, money } from "@/lib/format";
import type { Recommendation, RecommendationType, Severity } from "@/lib/types";

const TYPE_META: Record<RecommendationType, { label: string; icon: LucideIcon }> = {
  unassigned: { label: "Unassigned licenses", icon: PackageOpen },
  "disabled-account": { label: "Disabled accounts", icon: UserX },
  "inactive-user": { label: "Inactive users", icon: UserMinus },
  "duplicate-license": { label: "Duplicate licenses", icon: Copy },
  "tier-downgrade": { label: "Tier consolidation", icon: ArrowDownRight },
};

const SEV: Record<Severity, string> = {
  high: "bg-critical/10 text-critical",
  medium: "bg-serious/15 text-serious",
  low: "bg-surface-2 text-ink-2",
};

export function RecommendationList({ items, currency, limit }: { items: Recommendation[]; currency: string; limit?: number }) {
  const [filter, setFilter] = useState<RecommendationType | "all">("all");
  const counts = useMemo(() => {
    const m = new Map<RecommendationType, { n: number; savings: number }>();
    for (const r of items) {
      const e = m.get(r.type) ?? { n: 0, savings: 0 };
      e.n++;
      e.savings += r.monthlySavings;
      m.set(r.type, e);
    }
    return m;
  }, [items]);

  const shown = (filter === "all" ? items : items.filter((r) => r.type === filter)).slice(0, limit ?? Infinity);

  return (
    <div>
      {!limit && (
        <div className="mb-4 flex flex-wrap gap-2">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label={`All (${items.length})`} />
          {(Object.keys(TYPE_META) as RecommendationType[])
            .filter((t) => counts.has(t))
            .map((t) => (
              <FilterChip
                key={t}
                active={filter === t}
                onClick={() => setFilter(t)}
                label={`${TYPE_META[t].label} (${counts.get(t)!.n}) · ${money(counts.get(t)!.savings, currency)}`}
              />
            ))}
        </div>
      )}
      {shown.length === 0 && <p className="py-8 text-center text-sm text-ink-3">No recommendations. Nice and lean.</p>}
      <ul className="divide-y divide-line">
        {shown.map((r) => {
          const Icon = TYPE_META[r.type].icon;
          return (
            <li key={r.id} className="flex gap-4 py-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-2">
                <Icon size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{r.title}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium capitalize", SEV[r.severity])}>{r.severity}</span>
                </div>
                {r.user && <div className="truncate text-xs text-ink-3">{r.user}</div>}
                <p className="mt-1 text-sm text-ink-2">{r.detail}</p>
                <p className="mt-1 text-xs text-ink-3">Action: {r.action}</p>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-semibold tabular-nums text-good">{money(r.monthlySavings, currency)}</div>
                <div className="text-xs text-ink-3">/ month</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs",
        active ? "border-accent bg-accent/10 text-accent" : "border-line bg-surface text-ink-2 hover:text-ink",
      )}
    >
      {label}
    </button>
  );
}
