import type { PriceSource, SkuTier } from "@/lib/types";

/**
 * Monthly unit price book, keyed by skuPartNumber (the value Graph returns
 * on /subscribedSkus). Microsoft Graph exposes NO price data, so cost must
 * come from here.
 *
 * DEFAULTS ARE ESTIMATES. They are public Microsoft list prices in USD per user
 * per month on an annual commitment (Business and Enterprise plans as announced
 * for 1 July 2026; the rest are approximate list prices). Your agreement, currency,
 * tax, partner margin and monthly-billing premium will differ. Replace them with
 * your real rates in one of two ways, without editing code:
 *   - PRICE_OVERRIDES env var: JSON keyed by skuPartNumber, e.g. {"SPE_E3":39}
 *   - edit the entries below and rebuild
 * Overrides are shown as source "override" in the UI.
 *
 * VERIFY skuPartNumbers against your own tenant (Get-MgSubscribedSku) before
 * trusting the mapping; Microsoft occasionally renames them.
 */
export interface PriceEntry {
  displayName: string;
  monthly: number;
  source: PriceSource;
  tier: SkuTier;
  /** Tenant-wide entitlement pool: consumedUnits is never decremented, so unassigned != idle */
  pool?: boolean;
  observed?: number[];
  /** skuPartNumbers whose capabilities this SKU already includes (for overlap detection) */
  includes?: string[];
}

export const PRICE_BOOK: Record<string, PriceEntry> = {
  SPE_E5: {
    displayName: "Microsoft 365 E5",
    monthly: 60,
    source: "estimate",
    tier: "premium",
    includes: ["SPE_E3", "POWER_BI_PRO", "EXCHANGEENTERPRISE", "ENTERPRISEPACK", "DEFENDER_ENDPOINT_P1", "EMS"],
  },
  SPE_E3: {
    displayName: "Microsoft 365 E3",
    monthly: 39,
    source: "estimate",
    tier: "premium",
    includes: ["EXCHANGEENTERPRISE", "ENTERPRISEPACK", "EMS"],
  },
  // VERIFY: no-Teams E3 part number differs by agreement/region.
  "Microsoft_365_E3_(no_Teams)": {
    displayName: "Microsoft 365 E3 (no Teams)",
    monthly: 36,
    source: "estimate",
    tier: "premium",
    includes: ["EXCHANGEENTERPRISE"],
  },
  SPB: {
    displayName: "Microsoft 365 Business Premium",
    monthly: 22,
    source: "estimate",
    tier: "standard",
    includes: ["O365_BUSINESS_PREMIUM", "O365_BUSINESS_ESSENTIALS"],
  },
  O365_BUSINESS_PREMIUM: {
    displayName: "Microsoft 365 Business Standard",
    monthly: 14,
    source: "estimate",
    tier: "standard",
    includes: ["O365_BUSINESS_ESSENTIALS"],
  },
  O365_BUSINESS_ESSENTIALS: {
    displayName: "Microsoft 365 Business Basic",
    monthly: 7,
    source: "estimate",
    tier: "frontline",
  },
  SPE_F1: {
    displayName: "Microsoft 365 F3",
    monthly: 10,
    source: "estimate",
    tier: "frontline",
  },
  EXCHANGESTANDARD: {
    displayName: "Exchange Online (Plan 1)",
    monthly: 4,
    source: "estimate",
    tier: "frontline",
  },
  EXCHANGEENTERPRISE: {
    displayName: "Exchange Online (Plan 2)",
    monthly: 8,
    source: "estimate",
    tier: "addon",
  },
  Microsoft_365_Copilot: {
    displayName: "Microsoft 365 Copilot",
    monthly: 30,
    source: "estimate",
    tier: "addon",
  },
  PBI_PREMIUM_PER_USER: {
    displayName: "Power BI Premium Per User",
    monthly: 24,
    source: "estimate",
    tier: "addon",
    includes: ["POWER_BI_PRO"],
  },
  POWER_BI_PRO: {
    displayName: "Power BI Pro",
    monthly: 14,
    source: "estimate",
    tier: "addon",
  },
  VISIOCLIENT: {
    displayName: "Visio Plan 2",
    monthly: 15,
    source: "estimate",
    tier: "addon",
  },
  INTUNE_A: {
    displayName: "Microsoft Intune Plan 1",
    monthly: 8,
    source: "estimate",
    tier: "addon",
  },
  // Microsoft documents Intune Device as a tenant-wide pool that is never assigned to a
  // user or device object, so its consumed count stays 0. Never treat it as idle spend.
  INTUNE_A_D: {
    displayName: "Microsoft Intune Plan 1 Device",
    monthly: 2,
    source: "estimate",
    tier: "addon",
    pool: true,
  },
  // Free / trial / self-service SKUs: they cost nothing but clutter the inventory
  FLOW_FREE: { displayName: "Power Automate Free", monthly: 0, source: "free", tier: "free" },
  POWER_BI_STANDARD: { displayName: "Microsoft Fabric (Free)", monthly: 0, source: "free", tier: "free" },
  TEAMS_EXPLORATORY: { displayName: "Teams Exploratory", monthly: 0, source: "free", tier: "free" },
  WINDOWS_STORE: { displayName: "Windows Store for Business", monthly: 0, source: "free", tier: "free" },
  CCIBOTS_PRIVPREV_VIRAL: { displayName: "Copilot Studio Viral Trial", monthly: 0, source: "free", tier: "free" },
};

function overrides(): Record<string, number> {
  try {
    return process.env.PRICE_OVERRIDES ? JSON.parse(process.env.PRICE_OVERRIDES) : {};
  } catch {
    return {};
  }
}

export function lookupPrice(skuPartNumber: string): PriceEntry {
  const o = overrides();
  const base = PRICE_BOOK[skuPartNumber];
  if (o[skuPartNumber] !== undefined) {
    return {
      ...(base ?? { displayName: skuPartNumber, tier: "addon" as SkuTier }),
      monthly: Number(o[skuPartNumber]),
      source: "override",
    };
  }
  return (
    base ?? {
      displayName: skuPartNumber.replace(/_/g, " "),
      monthly: 0,
      source: "estimate",
      tier: "addon",
    }
  );
}

/** Downgrade ladder used by the tier-consolidation rules. */
export const DOWNGRADE_TARGET: Record<string, string> = {
  SPE_E5: "SPE_E3",
  SPE_E3: "SPE_F1",
  "Microsoft_365_E3_(no_Teams)": "SPE_F1",
  SPB: "O365_BUSINESS_ESSENTIALS",
  O365_BUSINESS_PREMIUM: "O365_BUSINESS_ESSENTIALS",
  EXCHANGEENTERPRISE: "EXCHANGESTANDARD",
};
