"use client";
import { ExternalLink, Loader2, Lock, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn, money } from "@/lib/format";

export interface SubRow {
  /** Friendly label: product name + purchase date when billing data is matched */
  label: string;
  purchased: string | null;
  /** Lowest quantity Microsoft will accept now: seats still assigned that this subscription must cover */
  minQty: number;
  id: string;
  billingName: string | null;
  channel: "mca" | "csp-or-other" | "unknown";
  isTrial: boolean;
  status: string;
  currentQty: number;
  targetQty: number;
  cut: number;
  renewal: string | null;
  term: string | null;
  autoRenew: "On" | "Off" | null;
  windowOpen: boolean;
  windowEndsAt: string | null;
}

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-CA", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" }) : "-");
const days = (d?: string | null) => (d ? Math.ceil((Date.parse(d) - Date.now()) / 86_400_000) : null);

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

type Pending =
  | { kind: "reduce"; row: SubRow; quantity: number }
  | { kind: "autoRenewOff"; row: SubRow }
  | { kind: "autoRenewOn"; row: SubRow };

export function SubscriptionActions({
  tenant,
  skuPartNumber,
  currency,
  unit,
  isAdmin,
  mock,
  rows,
  disabled,
}: {
  tenant: string;
  skuPartNumber: string;
  currency: string;
  unit: number;
  isAdmin: boolean;
  mock: boolean;
  rows: SubRow[];
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function execute() {
    if (!pending) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await post("/api/actions/billing", {
        tenant,
        subscription: pending.row.billingName,
        action: pending.kind,
        quantity: pending.kind === "reduce" ? pending.quantity : undefined,
        confirmText: pending.kind === "autoRenewOff" ? confirmText : undefined,
      });
      setMsg({ ok: true, text: `${r.detail}${r.status === 202 ? " (accepted; Microsoft finishes it in the background)" : ""}${r.mock ? " [demo mode: nothing was changed]" : ""}` });
      setPending(null);
      setConfirmText("");
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!rows.length) return <p className="text-sm text-ink-3">No subscriptions returned for this SKU.</p>;

  return (
    <div>
      <div className="-mx-5 overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
              <th className="px-5 py-2 font-medium">Subscription</th>
              <th className="px-3 py-2 font-medium">Billing</th>
              <th className="px-3 py-2 text-right font-medium">Seats</th>
              <th className="px-3 py-2 text-right font-medium">Suggested</th>
              <th className="px-3 py-2 font-medium">Renewal</th>
              <th className="px-3 py-2 font-medium">Reduction window</th>
              <th className="px-3 py-2 font-medium">Auto-renew</th>
              <th className="px-5 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = days(r.renewal);
              const canBill = isAdmin && !disabled && r.channel === "mca" && !!r.billingName && !r.isTrial;
              const q = qty[r.id] ?? Math.max(r.targetQty, r.minQty);
              const blockedBy = r.targetQty < r.minQty ? r.minQty - r.targetQty : 0;
              return (
                <tr key={r.id} className="border-b border-line last:border-0 align-top">
                  <td className="px-5 py-3">
                    <div className="font-medium text-ink">{r.label}</div>
                    <div className="text-xs text-ink-3">{r.purchased ? `Purchased ${fmt(r.purchased)} · ` : ""}<span className="font-mono" title={`Subscription ID ${r.id}${r.billingName ? `, billing ID ${r.billingName}` : ""}`}>{r.id.slice(0, 8)}</span></div>
                    <div className="text-xs text-ink-3">
                      {r.status}
                      {r.term ? ` · ${r.term === "P1Y" ? "annual" : r.term === "P1M" ? "monthly" : r.term} term` : ""}
                      {r.isTrial ? " · trial" : ""}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {r.channel === "mca" ? (
                      <span className="rounded bg-accent/10 px-1.5 py-0.5 text-accent">MCA (direct)</span>
                    ) : r.channel === "unknown" ? (
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-ink-3" title="Billing data not loaded: refresh the billing session">
                        Unknown
                      </span>
                    ) : (
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-ink-2" title="Not found in your MCA billing account: usually billed through a CSP partner">
                        Partner / other
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.currentQty}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {r.cut > 0 ? (
                      <span className="font-medium text-good" title={`Saves ${money(r.cut * unit, currency)}/mo`}>
                        {r.targetQty} <span className="text-xs text-ink-3">(-{r.cut})</span>
                      </span>
                    ) : (
                      <span className="text-ink-3">{r.currentQty}</span>
                    )}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {fmt(r.renewal)}
                    {d !== null && <div className={cn("text-xs", d <= 15 ? "text-serious" : "text-ink-3")}>{d >= 0 ? `in ${d} days` : `${-d} days ago`}</div>}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {r.channel === "unknown" ? (
                      <span className="text-ink-3">Needs billing session</span>
                    ) : r.channel !== "mca" ? (
                      <span className="text-ink-3">Ask your partner</span>
                    ) : r.windowOpen ? (
                      <span className="font-medium text-good">Open until {fmt(r.windowEndsAt)}</span>
                    ) : (
                      <span className="text-ink-3">Closed{r.renewal ? `; reopens ${fmt(r.renewal)}` : ""}</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs">{r.autoRenew ?? "-"}</td>
                  <td className="px-5 py-3 text-right">
                    {!isAdmin ? (
                      <span className="inline-flex items-center gap-1 text-xs text-ink-3" title="Needs the LicenseOptimizer.Admin role">
                        <Lock size={12} /> Read-only
                      </span>
                    ) : r.channel !== "mca" ? (
                      <a href="https://admin.microsoft.com/#/subscriptions" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                        Admin center <ExternalLink size={11} />
                      </a>
                    ) : (
                      <div className="flex flex-col items-end gap-2">
                        {r.windowOpen && r.cut > 0 && (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={r.minQty}
                              max={r.currentQty - 1}
                              value={q}
                              onChange={(e) => setQty({ ...qty, [r.id]: Number(e.target.value) })}
                              className="h-7 w-16 rounded border border-line bg-surface px-2 text-right text-xs"
                              aria-label="New seat quantity"
                            />
                            <button
                              disabled={!canBill || q >= r.currentQty || q < r.minQty}
                              onClick={() => setPending({ kind: "reduce", row: r, quantity: q })}
                              className="h-7 rounded bg-accent px-2.5 text-xs font-medium text-white disabled:opacity-40"
                            >
                              Reduce seats
                            </button>
                          </div>
                        )}
                        {r.windowOpen && blockedBy > 0 && (
                          <span className="max-w-[220px] text-right text-[11px] text-ink-3">
                            Floor now {r.minQty}. Remove {blockedBy} license(s) from inactive users below to reach {r.targetQty}.
                          </span>
                        )}
                        {r.autoRenew === "On" ? (
                          <button disabled={!canBill} onClick={() => setPending({ kind: "autoRenewOff", row: r })} className="text-xs text-critical hover:underline disabled:opacity-40">
                            Turn off auto-renew
                          </button>
                        ) : r.autoRenew === "Off" ? (
                          <button disabled={!canBill} onClick={() => setPending({ kind: "autoRenewOn", row: r })} className="text-xs text-accent hover:underline disabled:opacity-40">
                            Turn on auto-renew
                          </button>
                        ) : null}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pending && (
        <div className="mt-4 rounded-lg border border-serious/40 bg-serious/10 p-4 text-sm" role="alertdialog" aria-label="Confirm billing change">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <ShieldAlert size={16} className="text-serious" /> Confirm billing change {mock && <span className="text-xs font-normal text-ink-3">(demo mode, nothing will change)</span>}
          </div>
          {pending.kind === "reduce" && (
            <p>
              Reduce <b>{pending.row.label}</b> (<code className="text-xs">{pending.row.id.slice(0, 8)}</code>) from <b>{pending.row.currentQty}</b> to <b>{pending.quantity}</b> seats. Saves{" "}
              <b>{money((pending.row.currentQty - pending.quantity) * unit, currency)}/mo</b>. Microsoft may prorate a refund for the removed seats. Make sure the
              users have already been unlicensed, or Microsoft will reject the change.
            </p>
          )}
          {pending.kind === "autoRenewOff" && (
            <>
              <p>
                Turn auto-renew <b>Off</b>: the <b>entire</b> subscription ({pending.row.currentQty} seats) stops on <b>{fmt(pending.row.renewal)}</b> and every user licensed
                from it loses access. Use this only when the SKU is no longer needed. To keep some seats, wait for the renewal and reduce in the 7-day window instead.
              </p>
              <label className="mt-2 block text-xs text-ink-2">
                Type <code>{skuPartNumber}</code> to confirm
                <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="mt-1 block h-8 w-64 rounded border border-line bg-surface px-2 text-sm" />
              </label>
            </>
          )}
          {pending.kind === "autoRenewOn" && <p>Turn auto-renew back <b>On</b> for {pending.row.label}.</p>}
          <div className="mt-3 flex gap-2">
            <button
              onClick={execute}
              disabled={busy || (pending.kind === "autoRenewOff" && confirmText !== skuPartNumber)}
              className="inline-flex h-8 items-center gap-1.5 rounded bg-critical px-3 text-xs font-medium text-white disabled:opacity-40"
            >
              {busy && <Loader2 size={13} className="animate-spin" />} Confirm
            </button>
            <button onClick={() => setPending(null)} className="h-8 rounded border border-line px-3 text-xs">
              Cancel
            </button>
          </div>
        </div>
      )}
      {msg && <p className={cn("mt-3 text-sm", msg.ok ? "text-good" : "text-critical")}>{msg.text}</p>}
    </div>
  );
}

export interface ReclaimUserRow {
  id: string;
  displayName: string;
  userPrincipalName: string;
  reason: "disabled" | "inactive";
  lastActive: string | null;
  viaGroup: boolean;
}

export function ReclaimUsers({
  tenant,
  skuPartNumber,
  isAdmin,
  mock,
  users,
}: {
  tenant: string;
  skuPartNumber: string;
  isAdmin: boolean;
  mock: boolean;
  users: ReclaimUserRow[];
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ upn: string; status: string; reason: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const selectable = users.filter((u) => !u.viaGroup);

  function toggle(id: string) {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSel(n);
    setPreview(null);
  }

  async function run(dryRun: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await post("/api/actions/remove-licenses", { tenant, skuPartNumber, userIds: [...sel].slice(0, 50), dryRun });
      if (dryRun) setPreview(r.plan);
      else {
        setMsg({ ok: r.removed > 0, text: `Removed ${r.removed} of ${r.results.length} license(s).${r.mock ? " [demo mode: nothing was changed]" : ""}` });
        setPreview(null);
        setSel(new Set());
        router.refresh();
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!users.length) return <p className="py-4 text-sm text-ink-3">Nobody holding this SKU is disabled or inactive.</p>;

  return (
    <div>
      {isAdmin && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSel(sel.size === selectable.length ? new Set() : new Set(selectable.map((u) => u.id)))}
            className="h-8 rounded border border-line px-3 text-xs"
          >
            {sel.size === selectable.length ? "Clear selection" : `Select all removable (${selectable.length})`}
          </button>
          <button
            disabled={!sel.size || busy}
            onClick={() => run(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded bg-accent px-3 text-xs font-medium text-white disabled:opacity-40"
          >
            {busy && !preview && <Loader2 size={13} className="animate-spin" />} Review removal ({sel.size})
          </button>
          {sel.size > 50 && <span className="text-xs text-serious">Only the first 50 are processed per run.</span>}
        </div>
      )}

      {preview && (
        <div className="mb-4 rounded-lg border border-serious/40 bg-serious/10 p-4 text-sm">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <ShieldAlert size={16} className="text-serious" /> Remove {skuPartNumber} from {preview.filter((p) => p.status === "ready").length} user(s)?{" "}
            {mock && <span className="text-xs font-normal text-ink-3">(demo mode)</span>}
          </div>
          <p className="mb-2 text-xs text-ink-2">
            Users lose the services in this SKU (mailbox data is kept for 30 days after the Exchange license is removed). For offboarded users holding a mailbox you
            still need, convert it to a shared mailbox first.
          </p>
          <ul className="mb-3 max-h-40 overflow-auto text-xs">
            {preview.map((p) => (
              <li key={p.upn} className={p.status === "ready" ? "" : "text-ink-3"}>
                {p.status === "ready" ? "✓" : "✕"} {p.upn} <span className="text-ink-3">({p.reason})</span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button onClick={() => run(false)} disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded bg-critical px-3 text-xs font-medium text-white disabled:opacity-40">
              {busy && <Loader2 size={13} className="animate-spin" />} Confirm removal
            </button>
            <button onClick={() => setPreview(null)} className="h-8 rounded border border-line px-3 text-xs">
              Cancel
            </button>
          </div>
        </div>
      )}
      {msg && <p className={cn("mb-3 text-sm", msg.ok ? "text-good" : "text-critical")}>{msg.text}</p>}

      <div className="-mx-5 overflow-x-auto">
        <table className="w-full min-w-[700px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
              {isAdmin && <th className="w-10 px-5 py-2" />}
              <th className="px-3 py-2 font-medium">User</th>
              <th className="px-3 py-2 font-medium">Reason</th>
              <th className="px-3 py-2 font-medium">Last activity</th>
              <th className="px-5 py-2 font-medium">Assignment</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-line last:border-0">
                {isAdmin && (
                  <td className="px-5 py-2">
                    <input type="checkbox" disabled={u.viaGroup} checked={sel.has(u.id)} onChange={() => toggle(u.id)} aria-label={`Select ${u.displayName}`} />
                  </td>
                )}
                <td className="px-3 py-2">
                  <div className="font-medium">{u.displayName}</div>
                  <div className="text-xs text-ink-3">{u.userPrincipalName}</div>
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className={cn("rounded px-1.5 py-0.5", u.reason === "disabled" ? "bg-critical/10 text-critical" : "bg-serious/15 text-serious")}>
                    {u.reason === "disabled" ? "Sign-in blocked" : "Inactive"}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-ink-2">{u.lastActive ? fmt(u.lastActive) : "Never"}</td>
                <td className="px-5 py-2 text-xs">
                  {u.viaGroup ? (
                    <a
                      href={`https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/~/overview/userId/${u.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-accent hover:underline"
                      title="Licensed through a group: remove the user from the licensing group in Entra"
                    >
                      Via group <ExternalLink size={11} />
                    </a>
                  ) : (
                    <span className="text-ink-3">Direct</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
