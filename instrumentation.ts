/**
 * Next.js instrumentation hook: starts the daily reminder scheduler inside the Node server.
 * App Service: keep "Always On" enabled (B1+) so the process stays up. Duplicate runs (restarts,
 * scale-out) are harmless: the reminder ledger guarantees each email is sent once.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.ENABLE_SCHEDULER === "false") return;
  const { schedulerTick } = await import("./lib/reminders");
  setTimeout(() => void schedulerTick(), 30_000);
  setInterval(() => void schedulerTick(), 15 * 60_000);
}
