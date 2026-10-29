import "server-only";
import type { TenantConfig } from "@/lib/config";
import { getGraphToken } from "./auth";

const GRAPH = "https://graph.microsoft.com/v1.0";

async function graphFetch(
  tenant: TenantConfig,
  url: string,
  accept = "application/json",
  init?: { method: string; body: unknown },
): Promise<Response> {
  const token = await getGraphToken(tenant);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url.startsWith("http") ? url : `${GRAPH}${url}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: accept,
        ...(init ? { "Content-Type": "application/json" } : {}),
      },
      body: init ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
    if (res.status === 429 || res.status === 503) {
      const wait = Number(res.headers.get("Retry-After") || 2 ** attempt) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) {
      throw new Error(`Graph ${res.status} on ${url}: ${(await res.text()).slice(0, 300)}`);
    }
    return res;
  }
  throw new Error(`Graph throttled after 3 attempts: ${url}`);
}

async function getAllPages<T>(tenant: TenantConfig, url: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = url;
  while (next) {
    const res = await graphFetch(tenant, next);
    const json = (await res.json()) as { value: T[]; "@odata.nextLink"?: string };
    out.push(...json.value);
    next = json["@odata.nextLink"];
  }
  return out;
}

export interface GraphSubscribedSku {
  skuId: string;
  skuPartNumber: string;
  capabilityStatus: string;
  consumedUnits: number;
  prepaidUnits: { enabled: number; suspended: number; warning: number; lockedOut?: number };
}

export interface GraphUser {
  id: string;
  displayName: string;
  userPrincipalName: string;
  accountEnabled: boolean;
  department?: string | null;
  createdDateTime?: string | null;
  assignedLicenses: { skuId: string }[];
  /** assignedByGroup is set when the license comes from group-based licensing */
  licenseAssignmentStates?: { skuId: string; assignedByGroup?: string | null; state?: string }[];
}

export interface GraphCompanySubscription {
  id: string;
  commerceSubscriptionId?: string;
  skuId: string;
  skuPartNumber: string;
  status: string;
  isTrial: boolean;
  totalLicenses: number;
  createdDateTime?: string;
  nextLifecycleDateTime?: string | null;
}

/** GET /subscribedSkus  (Organization.Read.All) */
export function listSubscribedSkus(tenant: TenantConfig) {
  return getAllPages<GraphSubscribedSku>(tenant, "/subscribedSkus");
}

/** GET /users filtered to licensed users  (Directory.Read.All / User.Read.All) */
export function listLicensedUsers(tenant: TenantConfig) {
  // assignedLicenses/$count filter needs ConsistencyLevel: eventual; we filter client-side instead to keep it simple.
  return getAllPages<GraphUser>(
    tenant,
    "/users?$select=id,displayName,userPrincipalName,accountEnabled,department,createdDateTime,assignedLicenses,licenseAssignmentStates&$top=999",
  ).then((users) => users.filter((u) => u.assignedLicenses.length > 0));
}

/** GET /directory/subscriptions  (Organization.Read.All). Read-only: renewal dates per SKU. */
export function listCompanySubscriptions(tenant: TenantConfig) {
  return getAllPages<GraphCompanySubscription>(tenant, "/directory/subscriptions");
}

/**
 * POST /users/{id}/assignLicense with removeLicenses  (LicenseAssignment.ReadWrite.All).
 * Licenses inherited from a group cannot be removed this way; callers filter those out first.
 */
export async function removeUserLicense(tenant: TenantConfig, userId: string, skuId: string) {
  await graphFetch(tenant, `/users/${encodeURIComponent(userId)}/assignLicense`, "application/json", {
    method: "POST",
    body: { addLicenses: [], removeLicenses: [skuId] },
  });
}

/**
 * POST /users/{sender}/sendMail  (Mail.Send, scoped to one mailbox with Exchange RBAC for Applications).
 */
export async function sendMail(
  tenant: TenantConfig,
  sender: string,
  to: string[],
  subject: string,
  html: string,
) {
  await graphFetch(tenant, `/users/${encodeURIComponent(sender)}/sendMail`, "application/json", {
    method: "POST",
    body: {
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients: to.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: true,
    },
  });
}

export interface ActivityRow {
  upn: string;
  exchange: string | null;
  oneDrive: string | null;
  sharePoint: string | null;
  teams: string | null;
}

/**
 * GET /reports/getOffice365ActiveUserDetail(period='D90')  (Reports.Read.All)
 * Returns CSV via a 302 redirect to a short-lived download URL.
 *
 * NOTE: if "Display concealed user, group, and site names in all reports" is
 * OFF in the M365 admin center (Settings > Org settings > Reports), UPNs come
 * back as hashes and cannot be joined to users. We detect that and warn.
 */
export async function getActivityReport(tenant: TenantConfig): Promise<{ rows: ActivityRow[]; concealed: boolean }> {
  const res = await graphFetch(tenant, "/reports/getOffice365ActiveUserDetail(period='D90')", "text/csv");
  const text = (await res.text()).replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { rows: [], concealed: false };

  const header = parseCsvLine(lines[0]);
  const col = (name: string) => header.indexOf(name);
  const idx = {
    upn: col("User Principal Name"),
    exchange: col("Exchange Last Activity Date"),
    oneDrive: col("OneDrive Last Activity Date"),
    sharePoint: col("SharePoint Last Activity Date"),
    teams: col("Teams Last Activity Date"),
  };
  const rows = lines.slice(1).map((l) => {
    const c = parseCsvLine(l);
    const v = (i: number) => (i >= 0 && c[i] ? c[i] : null);
    return {
      upn: (v(idx.upn) || "").toLowerCase(),
      exchange: v(idx.exchange),
      oneDrive: v(idx.oneDrive),
      sharePoint: v(idx.sharePoint),
      teams: v(idx.teams),
    };
  });
  const concealed = rows.length > 0 && rows.every((r) => !r.upn.includes("@"));
  return { rows, concealed };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
