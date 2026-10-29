import { FlaskConical, PlugZap, UserCircle2 } from "lucide-react";
import { TenantSelector, type TenantOption } from "./TenantSelector";
import { ThemeToggle } from "./ThemeToggle";

export function Topbar({
  tenants,
  dataMode,
  userName,
}: {
  tenants: TenantOption[];
  dataMode: "mock" | "live";
  userName?: string | null;
}) {
  return (
    <header className="flex h-16 items-center gap-3 border-b border-line bg-surface px-4 md:px-6">
      <TenantSelector tenants={tenants} />
      {dataMode === "mock" ? (
        <span className="hidden items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2 sm:inline-flex">
          <FlaskConical size={13} /> Demo data
        </span>
      ) : (
        <span className="hidden items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2 sm:inline-flex">
          <PlugZap size={13} className="text-good" /> Live: Microsoft Graph
        </span>
      )}
      <div className="ml-auto flex items-center gap-3">
        {userName && (
          <span className="hidden items-center gap-1.5 text-sm text-ink-2 lg:inline-flex">
            <UserCircle2 size={16} /> {userName}
          </span>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}
