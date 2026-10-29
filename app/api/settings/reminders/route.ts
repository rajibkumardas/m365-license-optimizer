import { bad, handle } from "@/lib/api";
import { getPrincipal, requireAdmin } from "@/lib/auth";
import { getReminderSettings, saveReminderSettings, writeAudit } from "@/lib/store";
import type { ReminderSettings } from "@/lib/types";

export const dynamic = "force-dynamic";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  return handle(async () => {
    await getPrincipal();
    return getReminderSettings();
  });
}

export async function PUT(req: Request) {
  return handle(async () => {
    const me = await requireAdmin(req);
    const b = (await req.json()) as Partial<ReminderSettings>;
    const recipients = (b.recipients ?? []).map((r) => r.trim()).filter(Boolean);
    if (recipients.some((r) => !EMAIL.test(r))) bad("One of the recipient addresses is not valid");
    if (recipients.length > 20) bad("Maximum 20 recipients");
    const sender = (b.senderMailbox ?? "").trim();
    if (sender && !EMAIL.test(sender)) bad("Sender mailbox is not a valid address");
    const offsets = [...new Set((b.offsets ?? []).map(Number))].filter((n) => Number.isInteger(n) && n >= -90 && n <= 6).sort((x, y) => x - y);
    if (!offsets.length) bad("Add at least one reminder day (between -90 and +6; the reduction window is 7 days)");
    const runHour = Number(b.runHour ?? 8);
    if (!Number.isInteger(runHour) || runHour < 0 || runHour > 23) bad("Run hour must be 0-23");
    const seatBuffer = Number(b.seatBuffer ?? 0);
    if (!Number.isInteger(seatBuffer) || seatBuffer < 0 || seatBuffer > 50) bad("Seat buffer must be 0-50");
    if (b.enabled && (!sender || !recipients.length)) bad("Set a sender mailbox and at least one recipient before enabling reminders");
    const next: ReminderSettings = { enabled: !!b.enabled, senderMailbox: sender, recipients, offsets, runHour, seatBuffer };
    await saveReminderSettings(next);
    await writeAudit({ at: new Date().toISOString(), actor: me.name, tenantId: "all", action: "settings", target: "reminders", detail: JSON.stringify(next), result: "success" });
    return next;
  });
}
