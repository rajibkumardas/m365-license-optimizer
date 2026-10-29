"use client";
import { RefreshCw } from "lucide-react";
import { useState } from "react";

/**
 * Refreshes the App Service Authentication token store (/.auth/refresh). If that fails
 * (no refresh token yet, or billing scope never consented), re-runs the sign-in.
 */
export function BillingSessionButton() {
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    const back = window.location.pathname + window.location.search;
    try {
      const r = await fetch("/.auth/refresh");
      if (r.ok) {
        window.location.reload();
        return;
      }
    } catch {
      /* fall through */
    }
    window.location.href = `/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(back)}`;
  }
  return (
    <button onClick={refresh} disabled={busy} className="mt-2 inline-flex h-8 items-center gap-1.5 rounded border border-line bg-surface px-3 text-xs hover:text-accent">
      <RefreshCw size={13} className={busy ? "animate-spin" : ""} /> Refresh billing session
    </button>
  );
}
