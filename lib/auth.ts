import "server-only";
import { headers } from "next/headers";
import type { Principal } from "@/lib/types";

/**
 * App Service Authentication ("Easy Auth") injects the signed-in user as
 * X-MS-CLIENT-PRINCIPAL (base64 JSON). Roles come from the sign-in app's app roles:
 *   LicenseOptimizer.Admin  -> may run actions and change settings
 *   LicenseOptimizer.Reader -> read-only
 * Local development (no Easy Auth): DEV_ROLE=admin|reader, default reader.
 */
export const ADMIN_ROLE = "LicenseOptimizer.Admin";

interface EasyAuthPrincipal {
  claims: { typ: string; val: string }[];
  name_typ?: string;
  role_typ?: string;
}

export async function getPrincipal(): Promise<Principal> {
  const h = await headers();
  const raw = h.get("x-ms-client-principal");
  // In live mode the principal header is only trusted when App Service Authentication is on
  // (the platform strips client-supplied X-MS-* headers only then). deploy.sh sets
  // EASY_AUTH_ENABLED=true after verifying authsettingsV2.platform.enabled; turning sign-in off
  // later without removing this flag is a misconfiguration (see README, Security notes).
  const live = process.env.DATA_MODE === "live";
  if (live && String(process.env.EASY_AUTH_ENABLED).toLowerCase() !== "true") {
    return { name: "anonymous", roles: [], isAdmin: false };
  }
  if (!raw) {
    if (!live) {
      const role = process.env.DEV_ROLE === "admin" ? ADMIN_ROLE : "LicenseOptimizer.Reader";
      return { name: "local-dev", roles: [role], isAdmin: role === ADMIN_ROLE };
    }
    return { name: "anonymous", roles: [], isAdmin: false };
  }
  let p: EasyAuthPrincipal;
  try {
    p = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as EasyAuthPrincipal;
  } catch {
    return { name: "anonymous", roles: [], isAdmin: false };
  }
  const roleTyp = p.role_typ ?? "roles";
  const get = (t: string) => p.claims.find((c) => c.typ === t)?.val;
  const roles = p.claims.filter((c) => c.typ === roleTyp || c.typ === "roles").map((c) => c.val);
  return {
    name: h.get("x-ms-client-principal-name") ?? get("preferred_username") ?? "unknown",
    oid: get("http://schemas.microsoft.com/identity/claims/objectidentifier") ?? get("oid"),
    tid: get("http://schemas.microsoft.com/identity/claims/tenantid") ?? get("tid"),
    roles,
    isAdmin: roles.includes(ADMIN_ROLE),
  };
}

/**
 * The signed-in admin's Azure Resource Manager token from the Easy Auth token store
 * (requires loginParameters scope https://management.azure.com/user_impersonation).
 */
export async function getArmToken(): Promise<{ token: string | null; expired: boolean }> {
  const h = await headers();
  const token = h.get("x-ms-token-aad-access-token");
  const exp = h.get("x-ms-token-aad-expires-on");
  const expired = exp ? new Date(exp).getTime() < Date.now() + 60_000 : false;
  return { token: token && !expired ? token : null, expired };
}

/** Guard for state-changing API routes: admin role + same-origin request (CSRF). */
export async function requireAdmin(req: Request): Promise<Principal> {
  const me = await getPrincipal();
  if (!me.isAdmin) throw new HttpError(403, "This action needs the LicenseOptimizer.Admin role.");
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost = "";
  try {
    originHost = origin ? new URL(origin).host : "";
  } catch {
    originHost = "";
  }
  if (!originHost || !host || originHost !== host) throw new HttpError(403, "Cross-origin request rejected.");
  return me;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
