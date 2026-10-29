import "server-only";
import { config } from "@/lib/config";
import { MOCK_TENANTS, mockBilling } from "@/lib/data/mock";
import { getTenantSnapshot, listTenants, tenantConfig } from "@/lib/data/service";
import { sendMail } from "@/lib/graph/client";
import { buildSeatPlan, type SubscriptionPlan } from "@/lib/optimizer/seats";
import {
  getPreviousRenewal,
  getReminderSettings,
  recordLifecycle,
  releaseReminder,
  reminderAlreadySent,
  reserveReminder,
  writeAudit,
} from "@/lib/store";
import type { BillingSubscription, ReminderSettings } from "@/lib/types";

/**
 * Daily renewal reminders. MCA rule: seats can only be REMOVED in the 7 days after a renewal,
 * so the schedule is relative to renewal (defaults -15, 0, +5):
 *   before renewal  prepare: reclaim idle licenses, decide whether the whole subscription should lapse
 *   renewal day     reduction window is open (7 days)
 *   after renewal   window closing soon
 * Each (subscription, renewal date, offset) is sent at most once (ledger in Table Storage).
 */
const DAY = 86_400_000;
/** IANA time zone for the daily run hour (REMINDER_TIMEZONE, default UTC). */
const TZ = (() => {
  const tz = process.env.REMINDER_TIMEZONE || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    console.warn(`[reminders] invalid REMINDER_TIMEZONE "${tz}", using UTC`);
    return "UTC";
  }
})();
const dayKey = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(t)); // YYYY-MM-DD in TZ
/** Renewal dates are calendar dates (Graph returns them at 00:00Z): use the UTC date, not the local one. */
const utcDay = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

interface DueItem {
  key: string;
  tenantName: string;
  tenantId: string;
  skuName: string;
  skuPartNumber: string;
  plan: SubscriptionPlan;
  renewal: string;
  offset: number;
  windowEnd: string;
}

export interface ReminderRunResult {
  ranAt: string;
  dryRun: boolean;
  due: number;
  sent: boolean;
  recipients: string[];
  skippedReason?: string;
  preview?: string;
}

function baseUrl() {
  return process.env.APP_BASE_URL || (process.env.WEBSITE_HOSTNAME ? `https://${process.env.WEBSITE_HOSTNAME}` : "http://localhost:3000");
}

export async function collectDue(settings: ReminderSettings, now = Date.now()): Promise<DueItem[]> {
  const today = dayKey(now);
  const due: DueItem[] = [];
  for (const t of listTenants()) {
    const snap = await getTenantSnapshot(t.id);
    // Background job has no user token, so live mode uses Graph dates (window = renewal + 7 days).
    const billing: BillingSubscription[] =
      config.dataMode === "mock" ? mockBilling(MOCK_TENANTS.find((m) => m.id === t.id) ?? MOCK_TENANTS[0], snap.subscriptions) : [];

    for (const sku of snap.skus) {
      if (sku.isFree || sku.isTrial || sku.isPool || sku.unitPriceMonthly <= 0) continue;
      const plan = buildSeatPlan(snap, sku, billing, { inactivityDays: config.inactivityDays, seatBuffer: settings.seatBuffer });
      for (const sp of plan.subs) {
        const subId = sp.sub.commerceSubscriptionId ?? sp.sub.id;
        if (sp.sub.nextLifecycleDateTime) await recordLifecycle(subId, sp.sub.nextLifecycleDateTime);
        if (sp.cut <= 0) continue;
        const next = sp.sub.nextLifecycleDateTime;
        // The renewal that just happened: billing term start when known, else the date Graph
        // rolled forward from (only if recent), else today's date if Graph hasn't rolled yet.
        let prev = sp.billing?.termStartDate ?? (await getPreviousRenewal(subId));
        if (prev && now - Date.parse(prev) > 10 * DAY) prev = null;
        if (!prev && next && utcDay(next) <= today) prev = next;
        for (const offset of settings.offsets) {
          const anchor = offset < 0 ? next : prev;
          if (!anchor) continue;
          const dueDay = addDays(utcDay(anchor), offset);
          // Fire on the due day, or catch up within 2 days if the app was down
          const lag = (Date.parse(today) - Date.parse(dueDay)) / DAY;
          if (lag < 0 || lag > 2) continue;
          const key = `${subId}_${utcDay(anchor)}_${offset}`;
          if (await reminderAlreadySent(key)) continue;
          due.push({
            key,
            tenantName: snap.tenant.name,
            tenantId: snap.tenant.id,
            skuName: sku.displayName,
            skuPartNumber: sku.skuPartNumber,
            plan: sp,
            renewal: anchor,
            offset,
            windowEnd: sp.billing?.cancellationAllowedEndDate ?? new Date(Date.parse(anchor) + 7 * DAY).toISOString(),
          });
        }
      }
    }
  }
  return due;
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const fmt = (d: string) => new Date(d).toLocaleDateString("en-CA", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });

function stageText(i: DueItem) {
  if (i.offset < 0) return `Renews ${fmt(i.renewal)} (in ${-i.offset} days). Reclaim idle licenses now; if the whole subscription is no longer needed, turn auto-renew Off before the renewal date.`;
  if (i.offset === 0) return `Renewed ${fmt(i.renewal)}. The seat-reduction window is open until ${fmt(i.windowEnd)}.`;
  return `Seat-reduction window closes ${fmt(i.windowEnd)}. After that, the extra seats are billed until the next renewal.`;
}

export function renderEmail(items: DueItem[]) {
  const rows = items
    .map(
      (i) => `<tr>
  <td style="padding:6px 8px;border-bottom:1px solid #ddd"><a href="${baseUrl()}/licenses/${encodeURIComponent(i.skuPartNumber)}?tenant=${i.tenantId}">${esc(i.skuName)}</a><br><span style="color:#666;font-size:12px">${esc(i.tenantName)}</span></td>
  <td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:right">${i.plan.currentQty}</td>
  <td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:right"><b>${i.plan.targetQty}</b></td>
  <td style="padding:6px 8px;border-bottom:1px solid #ddd">${stageText(i)}${i.plan.channel === "csp-or-other" ? "<br><i>Billed outside the MCA account (for example via CSP): ask your partner to change it.</i>" : i.plan.channel === "unknown" ? "<br><i>If this subscription is billed through a partner (CSP), ask them to change it.</i>" : ""}</td>
</tr>`,
    )
    .join("");
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#111">
<p>${items.length} Microsoft 365 subscription(s) have idle paid seats with a renewal milestone today.</p>
<table style="border-collapse:collapse;width:100%"><thead><tr style="background:#f0f0f0;text-align:left">
<th style="padding:6px 8px">Subscription</th><th style="padding:6px 8px;text-align:right">Seats now</th><th style="padding:6px 8px;text-align:right">Seats needed</th><th style="padding:6px 8px">What to do</th></tr></thead>
<tbody>${rows}</tbody></table>
<p style="color:#666;font-size:12px">Microsoft only allows removing seats within 7 days after a purchase or renewal. "Seats needed" = assigned seats minus licenses held by disabled or inactive users. Open the License Optimizer to act: ${baseUrl()}/optimization</p>
</div>`;
}

export async function runReminders(opts: { dryRun?: boolean; force?: boolean; actor?: string } = {}): Promise<ReminderRunResult> {
  const settings = await getReminderSettings();
  const base: ReminderRunResult = { ranAt: new Date().toISOString(), dryRun: !!opts.dryRun, due: 0, sent: false, recipients: settings.recipients };
  if (!settings.enabled && !opts.force) return { ...base, skippedReason: "Reminders are disabled in Settings." };
  const items = await collectDue(settings);
  if (!items.length) return { ...base, skippedReason: "Nothing due today." };
  const html = renderEmail(items);
  const subject = `[License Optimizer] ${items.length} subscription(s): idle seats, renewal action needed`;
  if (opts.dryRun) return { ...base, due: items.length, preview: html };
  if (!settings.senderMailbox || !settings.recipients.length) return { ...base, due: items.length, skippedReason: "Sender mailbox or recipients not configured." };

  // Reserve every reminder first (atomic), so a restart or second instance cannot send it again.
  const mine: DueItem[] = [];
  for (const i of items) if (await reserveReminder(i.key)) mine.push(i);
  if (!mine.length) return { ...base, skippedReason: "Already sent by another run." };
  const finalHtml = mine.length === items.length ? html : renderEmail(mine);
  const finalSubject = `[License Optimizer] ${mine.length} subscription(s): idle seats, renewal action needed`;
  try {
    if (config.dataMode === "live") {
      const tenant = tenantConfig(listTenants()[0].id); // sender mailbox lives in the primary tenant
      await sendMail(tenant, settings.senderMailbox, settings.recipients, finalSubject, finalHtml);
    } else {
      console.log(`[reminders] mock mode, not sending. Would email ${settings.recipients.join(", ")}: ${finalSubject}`);
    }
  } catch (e) {
    for (const i of mine) await releaseReminder(i.key); // let the next run retry
    throw e;
  }
  await writeAudit({
    at: new Date().toISOString(),
    actor: opts.actor ?? "scheduler",
    tenantId: "all",
    action: "reminder-sent",
    target: settings.recipients.join(", "),
    detail: mine.map((i) => `${i.skuPartNumber} (${i.offset >= 0 ? "+" : ""}${i.offset}d)`).join("; "),
    result: config.dataMode === "live" ? "success" : "dry-run",
  }).catch((e) => console.error("[audit] write failed", e));
  return { ...base, due: mine.length, sent: true };
}

export async function sendTestEmail(actor: string) {
  const s = await getReminderSettings();
  if (!s.senderMailbox || !s.recipients.length) throw new Error("Set the sender mailbox and at least one recipient first.");
  const html = `<p>Test message from the M365 License Optimizer. Reminders are ${s.enabled ? "enabled" : "disabled"}; schedule: ${s.offsets.join(", ")} days relative to renewal.</p>`;
  if (config.dataMode === "live") {
    await sendMail(tenantConfig(listTenants()[0].id), s.senderMailbox, s.recipients, "[License Optimizer] Test email", html);
  }
  await writeAudit({ at: new Date().toISOString(), actor, tenantId: "all", action: "test-email", target: s.recipients.join(", "), detail: `from ${s.senderMailbox}`, result: config.dataMode === "live" ? "success" : "dry-run" });
}

/** Called every 15 minutes by the in-process scheduler; runs once per day at the configured hour. */
/** Keeps the per-subscription renewal history current even while reminders are off. */
async function trackLifecycles() {
  for (const t of listTenants()) {
    const snap = await getTenantSnapshot(t.id);
    for (const sub of snap.subscriptions) {
      if (sub.nextLifecycleDateTime) await recordLifecycle(sub.commerceSubscriptionId ?? sub.id, sub.nextLifecycleDateTime);
    }
  }
}

let lastRunDay = "";
let lastTrackDay = "";
export async function schedulerTick() {
  const s = await getReminderSettings();
  const today0 = dayKey(Date.now());
  if (!s.enabled) {
    if (lastTrackDay !== today0) {
      lastTrackDay = today0;
      await trackLifecycles().catch((e) => console.error("[reminders] lifecycle tracking failed", e));
    }
    return;
  }
  const now = Date.now();
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(new Date(now)));
  const today = dayKey(now);
  if (hour < s.runHour || lastRunDay === today) return;
  lastRunDay = today;
  try {
    const r = await runReminders();
    console.log(`[reminders] ${today}: due=${r.due} sent=${r.sent} ${r.skippedReason ?? ""}`);
  } catch (e) {
    console.error("[reminders] failed", e);
    lastRunDay = ""; // retry next tick
  }
}
