"use client";
import { Building2, ChevronDown } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface TenantOption {
  id: string;
  name: string;
}

export function TenantSelector({ tenants, allowAll = true }: { tenants: TenantOption[]; allowAll?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("tenant") ?? (allowAll ? "all" : tenants[0]?.id);

  function onChange(id: string) {
    const next = new URLSearchParams(params.toString());
    if (id === "all") next.delete("tenant");
    else next.set("tenant", id);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Tenant</span>
      <Building2 size={16} className="pointer-events-none absolute left-3 text-ink-3" />
      <select
        value={current}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 appearance-none rounded-lg border border-line bg-surface pl-9 pr-9 text-sm font-medium text-ink outline-none focus:ring-2 focus:ring-accent/40"
      >
        {allowAll && <option value="all">All tenants</option>}
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-3 text-ink-3" />
    </label>
  );
}
