"use client";
import { Loader2, Mail, Plus, Save, Send, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/format";
import type { ReminderSettings } from "@/lib/types";

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

const offsetLabel = (n: number) => (n < 0 ? `${-n} days before renewal` : n === 0 ? "On renewal day (window opens)" : `${n} days after renewal`);

export function ReminderSettingsForm({ initial, isAdmin, mock }: { initial: ReminderSettings; isAdmin: boolean; mock: boolean }) {
  const [s, setS] = useState<ReminderSettings>(initial);
  const [recipientsText, setRecipientsText] = useState(initial.recipients.join(", "));
  const [newOffset, setNewOffset] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const ro = !isAdmin;

  const current = (): ReminderSettings => ({
    ...s,
    recipients: recipientsText.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean),
  });

  async function save() {
    setBusy("save");
    setMsg(null);
    try {
      const saved = await call("/api/settings/reminders", "PUT", current());
      setS(saved);
      setRecipientsText(saved.recipients.join(", "));
      setMsg({ ok: true, text: "Saved." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function runPreview() {
    setBusy("preview");
    setMsg(null);
    try {
      const r = await call("/api/reminders/run", "POST", { dryRun: true });
      setPreview(r.preview ?? null);
      setMsg({ ok: true, text: r.preview ? `${r.due} reminder(s) would be sent today.` : r.skippedReason ?? "Nothing due today." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setMsg(null);
    try {
      await call("/api/reminders/test", "POST");
      setMsg({ ok: true, text: mock ? "Demo mode: test email logged, not sent." : "Test email sent." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  function addOffset() {
    const n = Number(newOffset);
    if (!Number.isInteger(n) || n < -90 || n > 6 || s.offsets.includes(n)) return;
    setS({ ...s, offsets: [...s.offsets, n].sort((a, b) => a - b) });
    setNewOffset("");
  }

  const input = "h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60";

  return (
    <div className="space-y-5 text-sm">
      <label className="flex items-center gap-3">
        <input type="checkbox" checked={s.enabled} disabled={ro} onChange={(e) => setS({ ...s, enabled: e.target.checked })} className="h-4 w-4" />
        <span className="font-medium">Send renewal reminder emails</span>
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-ink-2">Sender mailbox (shared mailbox the app may send from)</span>
          <input className={input} disabled={ro} value={s.senderMailbox} placeholder="license-reminders@contoso.com" onChange={(e) => setS({ ...s, senderMailbox: e.target.value })} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink-2">Recipients (comma separated, max 20)</span>
          <input className={input} disabled={ro} value={recipientsText} placeholder="it-admin@contoso.com" onChange={(e) => setRecipientsText(e.target.value)} />
        </label>
      </div>

      <div>
        <span className="mb-1 block text-xs text-ink-2">Reminder days, relative to each renewal (Microsoft allows seat removal only within 7 days after renewal)</span>
        <div className="flex flex-wrap gap-2">
          {s.offsets.map((o) => (
            <span key={o} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-3 py-1 text-xs">
              {offsetLabel(o)}
              {!ro && (
                <button onClick={() => setS({ ...s, offsets: s.offsets.filter((x) => x !== o) })} aria-label={`Remove ${offsetLabel(o)}`}>
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
          {!ro && (
            <span className="inline-flex items-center gap-1">
              <input
                type="number"
                className="h-7 w-20 rounded border border-line bg-surface px-2 text-xs"
                placeholder="-30"
                value={newOffset}
                onChange={(e) => setNewOffset(e.target.value)}
                aria-label="Days relative to renewal (-90 to +6)"
              />
              <button onClick={addOffset} className="inline-flex h-7 items-center gap-1 rounded border border-line px-2 text-xs">
                <Plus size={12} /> Add
              </button>
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-ink-2">Daily run hour (server time zone, set by REMINDER_TIMEZONE; default UTC)</span>
          <input type="number" min={0} max={23} className={input} disabled={ro} value={s.runHour} onChange={(e) => setS({ ...s, runHour: Number(e.target.value) })} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink-2">Seat buffer kept above assigned when suggesting cuts</span>
          <input type="number" min={0} max={50} className={input} disabled={ro} value={s.seatBuffer} onChange={(e) => setS({ ...s, seatBuffer: Number(e.target.value) })} />
        </label>
      </div>

      {isAdmin ? (
        <div className="flex flex-wrap gap-2">
          <button onClick={save} disabled={!!busy} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-50">
            {busy === "save" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </button>
          <button onClick={runPreview} disabled={!!busy} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-4 text-sm disabled:opacity-50">
            {busy === "preview" ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Preview today&apos;s email
          </button>
          <button onClick={test} disabled={!!busy} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-4 text-sm disabled:opacity-50">
            {busy === "test" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send test email
          </button>
        </div>
      ) : (
        <p className="text-xs text-ink-3">Read-only: changing settings needs the LicenseOptimizer.Admin role.</p>
      )}
      {msg && <p className={cn("text-sm", msg.ok ? "text-good" : "text-critical")}>{msg.text}</p>}
      {preview && (
        <div className="rounded-lg border border-line bg-white p-4 text-black">
          <div className="mb-2 text-xs text-neutral-500">Email preview</div>
          {/* Server-rendered from app data only (no user input), so safe to inject */}
          <div dangerouslySetInnerHTML={{ __html: preview }} />
        </div>
      )}
    </div>
  );
}
