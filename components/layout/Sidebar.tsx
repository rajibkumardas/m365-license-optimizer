"use client";
import { Gauge, KeyRound, LayoutDashboard, LineChart, Settings, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/format";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/licenses", label: "License inventory", icon: KeyRound },
  { href: "/optimization", label: "Optimization", icon: Sparkles },
  { href: "/forecast", label: "Forecast", icon: LineChart },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const params = useSearchParams();
  const tenant = params.get("tenant");
  const qs = tenant ? `?tenant=${encodeURIComponent(tenant)}` : "";

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
      <div className="flex h-16 items-center gap-2 border-b border-line px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">
          <Gauge size={18} />
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold">License Optimizer</div>
          <div className="text-xs text-ink-3">Microsoft 365</div>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={`${href}${qs}`}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm",
                active ? "bg-accent/10 font-medium text-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
              )}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-line p-4 text-xs text-ink-3">
        Prices: monthly, per seat. Graph has no price API; see Settings for the price book.
      </div>
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const params = useSearchParams();
  const tenant = params.get("tenant");
  const qs = tenant ? `?tenant=${encodeURIComponent(tenant)}` : "";
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-line bg-surface px-4 py-2 md:hidden">
      {NAV.map(({ href, label }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={`${href}${qs}`}
            className={cn("whitespace-nowrap rounded-md px-3 py-1.5 text-sm", active ? "bg-accent/10 text-accent" : "text-ink-2")}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
