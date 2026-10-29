import "server-only";
import { TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import type { AuditEntry, ReminderSettings } from "@/lib/types";

/**
 * Persistence for settings, the audit log and the reminder ledger.
 * Production: Azure Table Storage (STORAGE_ACCOUNT_NAME), authenticated with the Web App's
 * managed identity (role: Storage Table Data Contributor). No connection strings.
 * Local / mock: in-memory (resets on restart).
 */
export const DEFAULT_REMINDERS: ReminderSettings = {
  enabled: false,
  senderMailbox: process.env.REMINDER_SENDER || "",
  recipients: [],
  offsets: [-15, 0, 5],
  runHour: 8,
  seatBuffer: 0,
};

const mem = { settings: new Map<string, string>(), audit: [] as AuditEntry[], ledger: new Set<string>() };

function table(name: string): TableClient | null {
  const acct = process.env.STORAGE_ACCOUNT_NAME;
  if (!acct) return null;
  return new TableClient(`https://${acct}.table.core.windows.net`, name, new DefaultAzureCredential());
}

async function ensure(t: TableClient) {
  try {
    await t.createTable();
  } catch {
    /* exists */
  }
}

export async function getReminderSettings(): Promise<ReminderSettings> {
  const t = table("settings");
  let raw: string | undefined;
  if (t) {
    await ensure(t);
    try {
      const e = await t.getEntity<{ json: string }>("app", "reminders");
      raw = e.json;
    } catch {
      raw = undefined;
    }
  } else raw = mem.settings.get("reminders");
  return raw ? { ...DEFAULT_REMINDERS, ...(JSON.parse(raw) as Partial<ReminderSettings>) } : DEFAULT_REMINDERS;
}

export async function saveReminderSettings(s: ReminderSettings) {
  const json = JSON.stringify(s);
  const t = table("settings");
  if (t) {
    await ensure(t);
    await t.upsertEntity({ partitionKey: "app", rowKey: "reminders", json }, "Replace");
  } else mem.settings.set("reminders", json);
}

export async function writeAudit(e: AuditEntry) {
  const t = table("audit");
  if (t) {
    await ensure(t);
    await t.createEntity({
      partitionKey: e.at.slice(0, 7),
      rowKey: `${String(9e15 - Date.parse(e.at)).padStart(16, "0")}-${crypto.randomUUID()}`,
      ...e,
    });
  } else mem.audit.unshift(e);
}

export async function listAudit(limit = 50): Promise<AuditEntry[]> {
  const t = table("audit");
  if (!t) return mem.audit.slice(0, limit);
  await ensure(t);
  const out: AuditEntry[] = [];
  // Newest first within current and previous month partitions (inverted-tick row keys)
  const now = new Date();
  const months = [0, 1].map((i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  for (const pk of months) {
    for await (const e of t.listEntities<AuditEntry>({ queryOptions: { filter: `PartitionKey eq '${pk}'` } })) {
      out.push({ at: e.at, actor: e.actor, tenantId: e.tenantId, action: e.action, target: e.target, detail: e.detail, result: e.result });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Reminder ledger: one row per subscription + renewal date + offset, so emails are never duplicated. */
export async function reminderAlreadySent(key: string): Promise<boolean> {
  const t = table("reminders");
  if (!t) return mem.ledger.has(key);
  await ensure(t);
  try {
    await t.getEntity("sent", key);
    return true;
  } catch (e) {
    if ((e as { statusCode?: number }).statusCode === 404) return false;
    throw e; // storage problem: do not risk a duplicate send
  }
}

/**
 * Atomically reserve a reminder before sending. createEntity fails with 409 if another run
 * (restart, second instance) already reserved it, so each reminder goes out at most once.
 */
export async function reserveReminder(key: string): Promise<boolean> {
  const t = table("reminders");
  if (!t) {
    if (mem.ledger.has(key)) return false;
    mem.ledger.add(key);
    return true;
  }
  await ensure(t);
  try {
    await t.createEntity({ partitionKey: "sent", rowKey: key, at: new Date().toISOString() });
    return true;
  } catch (e) {
    if ((e as { statusCode?: number }).statusCode === 409) return false;
    throw e;
  }
}

/** Release reservations when the email could not be sent, so the next run retries. */
export async function releaseReminder(key: string) {
  const t = table("reminders");
  if (!t) {
    mem.ledger.delete(key);
    return;
  }
  try {
    await t.deleteEntity("sent", key);
  } catch {
    /* already gone */
  }
}

export async function markReminderSent(key: string) {
  const t = table("reminders");
  if (t) {
    await ensure(t);
    await t.upsertEntity({ partitionKey: "sent", rowKey: key, at: new Date().toISOString() });
  } else mem.ledger.add(key);
}

/**
 * Last nextLifecycleDateTime seen per subscription. When Graph rolls the date forward after a
 * renewal, the previous value is the renewal that just happened (start of the 7-day window).
 */
const memSubState = new Map<string, string>();

export async function getLastSeenLifecycle(subId: string): Promise<string | null> {
  const t = table("substate");
  if (!t) return memSubState.get(subId) ?? null;
  await ensure(t);
  try {
    const e = await t.getEntity<{ lifecycle: string; previous?: string }>("sub", subId);
    return e.lifecycle;
  } catch {
    return null;
  }
}

export async function getPreviousRenewal(subId: string): Promise<string | null> {
  const t = table("substate");
  if (!t) return memSubState.get(`${subId}:prev`) ?? null;
  await ensure(t);
  try {
    const e = await t.getEntity<{ previous?: string }>("sub", subId);
    return e.previous ?? null;
  } catch {
    return null;
  }
}

export async function recordLifecycle(subId: string, lifecycle: string) {
  const last = await getLastSeenLifecycle(subId);
  const rolled = last && last !== lifecycle && Date.parse(last) <= Date.now();
  const previous = rolled ? last : await getPreviousRenewal(subId);
  const t = table("substate");
  if (t) {
    await ensure(t);
    await t.upsertEntity({ partitionKey: "sub", rowKey: subId, lifecycle, ...(previous ? { previous } : {}) }, "Replace");
  } else {
    memSubState.set(subId, lifecycle);
    if (previous) memSubState.set(`${subId}:prev`, previous);
  }
}
