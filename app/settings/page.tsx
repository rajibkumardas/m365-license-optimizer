import { CheckCircle2, CircleDashed } from "lucide-react";
import { BillingSessionButton } from "@/components/dashboard/BillingSessionButton";
import { Card, PageHeader } from "@/components/dashboard/PageHeader";
import { ReminderSettingsForm } from "@/components/dashboard/ReminderSettingsForm";
import { getPrincipal } from "@/lib/auth";
import { config, publicTenantList } from "@/lib/config";
import { getReminderSettings, listAudit } from "@/lib/store";
import { money } from "@/lib/format";
import { PRICE_BOOK } from "@/lib/pricing/priceBook";

const PERMISSIONS = [
  { scope: "Organization.Read.All", why: "GET /subscribedSkus and /directory/subscriptions: seat counts and renewal dates" },
  { scope: "Directory.Read.All", why: "GET /users: assignedLicenses, licenseAssignmentStates, accountEnabled" },
  { scope: "Reports.Read.All", why: "GET /reports/getOffice365ActiveUserDetail(period='D90'): last activity per service" },
  { scope: "LicenseAssignment.ReadWrite.All", why: "POST /users/{id}/assignLicense: remove licenses (admin action, audited)" },
  { scope: "Mail.Send (Exchange RBAC for Applications)", why: "Reminder emails, scoped to the sender shared mailbox only; not granted tenant-wide in Entra" },
  { scope: "Azure Service Management (delegated)", why: "Billing API with the signed-in admin's own MCA billing role: seat reductions, auto-renew" },
];

export default async function SettingsPage() {
  const [me, reminders, audit] = await Promise.all([getPrincipal(), getReminderSettings(), listAudit(30)]);
  let tenants: ReturnType<typeof publicTenantList> = [];
  let tenantError: string | null = null;
  try {
    tenants = publicTenantList();
  } catch (e) {
    tenantError = (e as Error).message;
  }
  const hasCreds = Boolean(config.clientId && config.clientSecret);

  return (
    <>
      <PageHeader title="Settings" subtitle="Connection details come from App Service environment variables; reminder settings are edited here and stored in Azure Table Storage." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Connection">
          <dl className="space-y-3 text-sm">
            <Row k="Data mode" v={config.dataMode === "live" ? "Live (Microsoft Graph)" : "Mock (demo data)"} />
            <Row k="Currency" v={config.currency} />
            <Row k="Inactivity threshold" v={`${config.inactivityDays} days`} />
            <Row k="Global CLIENT_ID / CLIENT_SECRET" v={hasCreds ? "Configured" : "Not set"} ok={hasCreds} />
            <Row k="Configured tenants" v={tenantError ?? (tenants.length ? tenants.map((t) => t.name).join(", ") : "None")} ok={!tenantError && tenants.length > 0} />
            <Row k="Settings & audit storage" v={process.env.STORAGE_ACCOUNT_NAME ? `Azure Table Storage (${process.env.STORAGE_ACCOUNT_NAME})` : "In memory (resets on restart)"} ok={!!process.env.STORAGE_ACCOUNT_NAME} />
            <Row k="Signed in as" v={`${me.name} (${me.isAdmin ? "Admin" : "Reader"})`} ok={me.isAdmin} />
          </dl>
          {config.dataMode === "live" && <BillingSessionButton />}
        </Card>
        <Card title="Permissions" subtitle="Reads are app-only. Writes are admin-gated, confirmed and audited.">
          <ul className="space-y-3 text-sm">
            {PERMISSIONS.map((p) => (
              <li key={p.scope}>
                <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{p.scope}</code>
                <p className="mt-1 text-ink-2">{p.why}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card className="mt-6" title="Renewal reminders" subtitle="Daily job inside the app. Each subscription, renewal and reminder day is emailed once, only when it has idle paid seats.">
        <ReminderSettingsForm initial={reminders} isAdmin={me.isAdmin} mock={config.dataMode !== "live"} />
      </Card>
      <Card className="mt-6" title="Audit log" subtitle="Every action, settings change and reminder, newest first (last 2 months).">
        {audit.length === 0 ? (
          <p className="text-sm text-ink-3">No entries yet.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
                  <th className="px-5 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Who</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Target</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                  <th className="px-5 py-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a, i) => (
                  <tr key={i} className="border-b border-line last:border-0 align-top">
                    <td className="px-5 py-2 whitespace-nowrap text-xs">{new Date(a.at).toLocaleString("en-CA")}</td>
                    <td className="px-3 py-2 text-xs">{a.actor}</td>
                    <td className="px-3 py-2 text-xs">{a.action}</td>
                    <td className="px-3 py-2 text-xs">{a.target}</td>
                    <td className="px-3 py-2 text-xs">{a.result}</td>
                    <td className="max-w-md truncate px-5 py-2 text-xs text-ink-3" title={a.detail}>{a.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card className="mt-6" title="Price book" subtitle="Monthly unit prices keyed by skuPartNumber. Override with PRICE_OVERRIDES. 'Invoice' = observed on real MCA invoices.">
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
                <th className="px-5 py-2 font-medium">skuPartNumber</th>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 text-right font-medium">Unit / mo</th>
                <th className="px-5 py-2 font-medium">Other observed prices</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(PRICE_BOOK).map(([k, p]) => (
                <tr key={k} className="border-b border-line last:border-0">
                  <td className="px-5 py-2 font-mono text-xs">{k}</td>
                  <td className="px-3 py-2">{p.displayName}</td>
                  <td className="px-3 py-2 capitalize text-ink-2">{p.source}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(p.monthly, config.currency)}</td>
                  <td className="px-5 py-2 text-xs text-ink-3">{p.observed?.map((o) => money(o, config.currency)).join(" / ") ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function Row({ k, v, ok }: { k: string; v: string; ok?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-ink-2">{k}</dt>
      <dd className="flex items-center gap-1.5 text-right font-medium">
        {ok !== undefined && (ok ? <CheckCircle2 size={14} className="text-good" /> : <CircleDashed size={14} className="text-ink-3" />)}
        {v}
      </dd>
    </div>
  );
}
