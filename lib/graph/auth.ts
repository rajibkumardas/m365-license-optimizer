import "server-only";
import { config, type TenantConfig } from "@/lib/config";

/**
 * OAuth2 client credentials flow against Microsoft Entra ID.
 * Requires an app registration with these APPLICATION permissions,
 * admin-consented in every tenant you connect:
 *   - Organization.Read.All   (GET /subscribedSkus)
 *   - Directory.Read.All      (GET /users with assignedLicenses)
 *   - Reports.Read.All        (GET /reports/getOffice365ActiveUserDetail)
 *
 * Production hardening (recommended): swap the client secret for a
 * certificate credential or a federated credential from the App Service
 * Managed Identity, so no secret is stored in app settings at all.
 */
interface CachedToken {
  token: string;
  expiresAt: number;
}

const cache = new Map<string, CachedToken>();

export async function getGraphToken(tenant: TenantConfig): Promise<string> {
  const clientId = tenant.clientId || config.clientId;
  const clientSecret = tenant.clientSecret || config.clientSecret;
  if (!clientId || !clientSecret) {
    throw new Error(
      `No CLIENT_ID/CLIENT_SECRET configured for tenant "${tenant.id}". Set DATA_MODE=mock or supply credentials.`,
    );
  }

  const key = `${tenant.tenantId}:${clientId}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt - 60_000 > Date.now()) return hit.token;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenant.tenantId)}/oauth2/v2.0/token`,
    { method: "POST", body, cache: "no-store" },
  );
  if (!res.ok) {
    const err = await res.text();
    // Surface the AADSTS code but never the secret.
    throw new Error(`Token request failed for tenant "${tenant.id}" (${res.status}): ${err.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cache.set(key, { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 });
  return json.access_token;
}
