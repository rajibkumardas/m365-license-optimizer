export type PriceSource = "invoice" | "estimate" | "free" | "override";

export interface LicenseSku {
  skuId: string;
  skuPartNumber: string;
  displayName: string;
  /** prepaidUnits.enabled from /subscribedSkus */
  purchased: number;
  /** consumedUnits from /subscribedSkus */
  assigned: number;
  unassigned: number;
  unitPriceMonthly: number;
  priceSource: PriceSource;
  monthlyCost: number;
  wastedMonthly: number;
  isFree: boolean;
  /** All subscriptions for this SKU are trials (from /directory/subscriptions) */
  isTrial: boolean;
  /** Tenant-wide entitlement pool (e.g. Intune Plan 1 Device): never "assigned", so never idle */
  isPool: boolean;
  tier: SkuTier;
  /** Earliest upcoming renewal/lifecycle date across this SKU's subscriptions */
  nextRenewal?: string | null;
}

export type SkuTier = "premium" | "standard" | "frontline" | "addon" | "free";

export interface UserActivity {
  id: string;
  displayName: string;
  userPrincipalName: string;
  department?: string;
  accountEnabled: boolean;
  skuPartNumbers: string[];
  /** false when usage data is missing for this user (not in report, concealed report): never flag inactive */
  activityKnown?: boolean;
  /** Account creation date; accounts younger than the inactivity window are never flagged */
  createdDateTime?: string | null;
  /** skuPartNumbers assigned through group-based licensing (cannot be removed per user) */
  groupAssignedSkus?: string[];
  lastExchange?: string | null;
  lastOneDrive?: string | null;
  lastSharePoint?: string | null;
  lastTeams?: string | null;
}

export type RecommendationType =
  | "unassigned"
  | "inactive-user"
  | "disabled-account"
  | "tier-downgrade"
  | "duplicate-license";

export type Severity = "high" | "medium" | "low";

export interface Recommendation {
  id: string;
  type: RecommendationType;
  severity: Severity;
  title: string;
  detail: string;
  /** Affected user UPN, when user-scoped */
  user?: string;
  fromSku?: string;
  toSku?: string;
  quantity: number;
  monthlySavings: number;
  action: string;
}

export interface MonthlySpend {
  month: string; // YYYY-MM
  amount: number;
}

export interface TenantSnapshot {
  tenant: { id: string; name: string; tenantId: string };
  currency: string;
  dataMode: "mock" | "live";
  generatedAt: string;
  skus: LicenseSku[];
  users: UserActivity[];
  spendHistory: MonthlySpend[];
  spendHistorySource: string;
  subscriptions: SkuSubscription[];
  warnings: string[];
}

/** One commercial subscription behind a SKU (GET /directory/subscriptions). */
export interface SkuSubscription {
  id: string;
  commerceSubscriptionId?: string;
  skuId: string;
  skuPartNumber: string;
  status: string;
  isTrial: boolean;
  totalLicenses: number;
  createdDateTime?: string | null;
  /** Next renewal (or expiry / disable) date */
  nextLifecycleDateTime?: string | null;
}

/** Microsoft Customer Agreement billing view of a seat-based subscription (Azure Billing API). */
export interface BillingSubscription {
  billingAccountName: string;
  /** billingSubscriptionName; for M365 seat products this matches commerceSubscriptionId */
  name: string;
  displayName: string;
  quantity: number;
  autoRenew: "On" | "Off";
  status: string;
  termStartDate?: string | null;
  termEndDate?: string | null;
  termDuration?: string | null;
  billingFrequency?: string | null;
  renewalQuantity?: number | null;
  cancellation?: "Allowed" | "NotAllowed" | null;
  /** Last day self-serve seat reduction is allowed (the post-renewal 7-day window) */
  cancellationAllowedEndDate?: string | null;
  /** Commercial product name, e.g. "Microsoft 365 E3" (displayName is usually empty) */
  productType?: string | null;
  purchaseDate?: string | null;
  /** Tenant the seats are provisioned to (one billing account can serve several tenants) */
  provisioningTenantId?: string | null;
}

export interface Principal {
  name: string;
  oid?: string;
  tid?: string;
  roles: string[];
  isAdmin: boolean;
}

export interface AuditEntry {
  at: string;
  actor: string;
  tenantId: string;
  action: "remove-licenses" | "reduce-seats" | "auto-renew" | "settings" | "reminder-sent" | "test-email";
  target: string;
  detail: string;
  result: "success" | "partial" | "failed" | "dry-run";
}

export interface ReminderSettings {
  enabled: boolean;
  senderMailbox: string;
  recipients: string[];
  /** Days relative to renewal: negative = before, 0 = renewal day, positive = after */
  offsets: number[];
  /** Hour of day (REMINDER_TIMEZONE, default UTC) the daily job runs */
  runHour: number;
  /** Seats to keep above the assigned count when suggesting reductions */
  seatBuffer: number;
}

export interface TenantSummary {
  id: string;
  name: string;
  monthlyCost: number;
  wastedMonthly: number;
  potentialSavings: number;
  purchased: number;
  assigned: number;
}
