import "server-only";
import type { BillingSubscription } from "@/lib/types";

/**
 * Azure Billing REST API (api-version 2024-04-01) for Microsoft Customer Agreement accounts.
 *
 * Authorization is DELEGATED: every call uses the signed-in admin's own ARM access token
 * (App Service Authentication token store, scope https://management.azure.com/user_impersonation).
 * The app itself holds no billing permission, so what an admin can do here is exactly what
 * their MCA billing role (Billing account/profile owner or contributor) allows in the portal.
 *
 * Microsoft rules this code respects (verified on learn.microsoft.com):
 *  - MCA seat reductions are only allowed within 7 days after purchase or renewal
 *    (systemOverrides.cancellationAllowedEndDate). There is no "reduce at renewal".
 *  - Turning auto-renew Off makes the WHOLE subscription expire at term end.
 *  - The /cancel operation is Microsoft Partner Agreement only, so it is not used.
 *  - CSP-billed subscriptions are not visible here; they are handled by reminders only.
 */
const ARM = "https://management.azure.com";
const API = "api-version=2024-04-01";

export class BillingAuthError extends Error {}

async function arm(token: string, path: string, init?: { method: string; body?: unknown }) {
  const res = await fetch(`${ARM}${path}${path.includes("?") ? "&" : "?"}${API}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) {
    throw new BillingAuthError(
      `Billing API ${res.status}: your account needs an MCA billing role (Billing account or profile owner/contributor), or your session token expired.`,
    );
  }
  if (!res.ok && res.status !== 202) {
    throw new Error(`Billing API ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
  return res;
}

interface ArmList<T> {
  value: T[];
  nextLink?: string;
}

interface RawBillingAccount {
  name: string;
  properties: { agreementType?: string; displayName?: string; accountStatus?: string };
}

interface RawBillingSubscription {
  name: string;
  properties: {
    displayName?: string;
    productType?: string;
    purchaseDate?: string;
    provisioningTenantId?: string;
    quantity?: number;
    autoRenew?: "On" | "Off";
    status?: string;
    productCategory?: string;
    termStartDate?: string;
    termEndDate?: string;
    termDuration?: string;
    billingFrequency?: string;
    renewalTermDetails?: { quantity?: number };
    systemOverrides?: { cancellation?: "Allowed" | "NotAllowed"; cancellationAllowedEndDate?: string };
  };
}

/** First active Microsoft Customer Agreement billing account the user can see, or the configured one. */
export async function findMcaAccount(token: string): Promise<string | null> {
  if (process.env.BILLING_ACCOUNT_NAME) return process.env.BILLING_ACCOUNT_NAME;
  const res = await arm(token, "/providers/Microsoft.Billing/billingAccounts");
  const json = (await res.json()) as ArmList<RawBillingAccount>;
  const mca = json.value.find(
    (a) => a.properties.agreementType === "MicrosoftCustomerAgreement" && a.properties.accountStatus !== "Disabled",
  );
  return mca?.name ?? null;
}

export async function listSeatSubscriptions(token: string): Promise<BillingSubscription[]> {
  const account = await findMcaAccount(token);
  if (!account) return [];
  const out: BillingSubscription[] = [];
  let path: string | undefined = `/providers/Microsoft.Billing/billingAccounts/${encodeURIComponent(account)}/billingSubscriptions`;
  while (path) {
    const res = await arm(token, path);
    const json = (await res.json()) as ArmList<RawBillingSubscription>;
    for (const s of json.value) {
      if (s.properties.productCategory && s.properties.productCategory !== "SeatBased") continue;
      out.push({
        billingAccountName: account,
        name: s.name,
        displayName: s.properties.displayName || s.properties.productType || s.name,
        productType: s.properties.productType ?? null,
        purchaseDate: s.properties.purchaseDate ?? null,
        provisioningTenantId: s.properties.provisioningTenantId ?? null,
        quantity: s.properties.quantity ?? 0,
        autoRenew: s.properties.autoRenew ?? "On",
        status: s.properties.status ?? "Unknown",
        termStartDate: s.properties.termStartDate ?? null,
        termEndDate: s.properties.termEndDate ?? null,
        termDuration: s.properties.termDuration ?? null,
        billingFrequency: s.properties.billingFrequency ?? null,
        renewalQuantity: s.properties.renewalTermDetails?.quantity ?? null,
        cancellation: s.properties.systemOverrides?.cancellation ?? null,
        cancellationAllowedEndDate: s.properties.systemOverrides?.cancellationAllowedEndDate ?? null,
      });
    }
    // nextLink may be absolute OR a bare path (verified: billingSubscriptions returns a path).
    // Resolve against ARM and drop api-version, which arm() adds back.
    if (json.nextLink) {
      const u = new URL(json.nextLink, ARM);
      u.searchParams.delete("api-version");
      path = u.pathname + (u.searchParams.toString() ? `?${u.searchParams.toString()}` : "");
    } else path = undefined;
  }
  return out;
}

/** Is a seat reduction allowed right now? (inside the post-purchase/renewal window) */
export function reductionWindow(b: BillingSubscription, now = Date.now()) {
  const end = b.cancellationAllowedEndDate ? new Date(b.cancellationAllowedEndDate).getTime() : null;
  const open = b.cancellation === "Allowed" && end !== null && now <= end;
  return { open, endsAt: b.cancellationAllowedEndDate ?? null };
}

/** PATCH quantity and/or autoRenew. Returns 200 or 202 (async; Microsoft completes it in the background). */
export async function patchSubscription(
  token: string,
  b: Pick<BillingSubscription, "billingAccountName" | "name">,
  props: { quantity?: number; autoRenew?: "On" | "Off" },
) {
  const res = await arm(
    token,
    `/providers/Microsoft.Billing/billingAccounts/${encodeURIComponent(b.billingAccountName)}/billingSubscriptions/${encodeURIComponent(b.name)}`,
    { method: "PATCH", body: { properties: props } },
  );
  return { status: res.status, operation: res.headers.get("Location") };
}
