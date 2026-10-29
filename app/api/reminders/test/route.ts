import { handle } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { sendTestEmail } from "@/lib/reminders";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireAdmin(req);
    await sendTestEmail(me.name);
    return { ok: true };
  });
}
