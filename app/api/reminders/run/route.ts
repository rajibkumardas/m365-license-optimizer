import { handle } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { runReminders } from "@/lib/reminders";

export const dynamic = "force-dynamic";

/** Manual run from Settings. dryRun=true returns the email preview without sending. */
export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireAdmin(req);
    const { dryRun } = (await req.json().catch(() => ({}))) as { dryRun?: boolean };
    return runReminders({ dryRun: dryRun !== false, force: true, actor: me.name });
  });
}
