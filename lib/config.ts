import "server-only";

export type DataMode = "mock" | "live";

export interface TenantConfig {
  /** Short slug used in URLs (?tenant=contoso) */
  id: string;
  name: string;
  /** Entra directory (tenant) ID */
  tenantId: string;
  clientId?: string;
  clientSecret?: string;
}

function parseTenants(): TenantConfig[] {
  const raw = process.env.TENANTS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as TenantConfig[];
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("empty");
      return parsed.map((t) => {
        if (!t.id || !t.tenantId) throw new Error("each tenant needs id and tenantId");
        return { ...t, name: t.name || t.id };
      });
    } catch (e) {
      throw new Error(`TENANTS env var is not valid JSON: ${(e as Error).message}`);
    }
  }
  if (process.env.AZURE_TENANT_ID) {
    return [
      {
        id: "default",
        name: process.env.TENANT_DISPLAY_NAME || "Primary tenant",
        tenantId: process.env.AZURE_TENANT_ID,
      },
    ];
  }
  return [];
}

export const config = {
  dataMode: (process.env.DATA_MODE === "live" ? "live" : "mock") as DataMode,
  currency: process.env.CURRENCY || "USD",
  inactivityDays: Number(process.env.INACTIVITY_DAYS || 90),
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  get tenants(): TenantConfig[] {
    return parseTenants();
  },
};

/** Never returns secrets; safe to send to the browser. */
export function publicTenantList() {
  return config.tenants.map(({ id, name, tenantId }) => ({ id, name, tenantId }));
}
