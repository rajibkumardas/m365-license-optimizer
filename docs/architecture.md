# Architecture

## Stack

- Next.js 15 App Router, React 19, TypeScript 5 (Next 15 needs the JavaScript compiler API, so do not move to TypeScript 7)
- Tailwind CSS v4 via `@tailwindcss/postcss`; design tokens are CSS variables in `app/globals.css`; dark mode via `[data-theme="dark"]` set by next-themes
- Lucide icons and Recharts; `@azure/data-tables` and `@azure/identity` (managed identity, no keys) for settings, the audit log and the reminder ledger
- `output: "standalone"` in `next.config.ts`; the Dockerfile runs `node server.js` on port 8080 (`WEBSITES_PORT=8080`)
- No font fetch at build time (system font stack), so builds work behind proxies and inside Azure Container Registry

## File structure

```
.
├── app/                     Pages (server components) and API route handlers
│   ├── page.tsx             Overview (all tenants, or one tenant with ?tenant=)
│   ├── licenses/            Inventory and SKU detail pages
│   ├── optimization/        Recommendations
│   ├── forecast/            12-month cost forecast
│   ├── settings/            Reminder settings, audit log, price book
│   └── api/                 health, tenants, actions (remove-licenses, billing), reminders, settings
├── components/              layout, dashboard widgets, theme provider
├── lib/
│   ├── config.ts            Env parsing, single or multi tenant
│   ├── auth.ts              App Service Authentication principal and roles
│   ├── graph/               Token acquisition, Graph client (paging, 429 retry)
│   ├── billing/             Azure Billing API client and the Graph-to-billing join
│   ├── data/                service.ts (mock or live switch), mock.ts (synthetic demo data)
│   ├── optimizer/           engine.ts (rules), seats.ts (seat plan), forecast.ts
│   ├── pricing/priceBook.ts Unit prices, downgrade ladder, overlap map
│   ├── reminders.ts         Daily job, ledger, email composition
│   └── store.ts             Table Storage (settings, audit, ledger)
├── deploy/                  deploy.sh phases, Set-MailSendScope.ps1, example.conf
├── setup.sh                 Interactive setup wizard
└── Dockerfile               Multi-stage build, standalone output
```

## Design rules

- `lib/config.ts`, `lib/graph/*`, `lib/billing/*`, `lib/data/*`, `lib/store.ts` and `lib/reminders.ts` import `server-only`. Secrets and user tokens never reach the browser.
- Pages are server components that read `searchParams.tenant`. Client components are used only for interactivity.
- `lib/data/service.ts` is the single mock or live switch (`DATA_MODE`). Every new data source needs a mock in `lib/data/mock.ts` so the UI is always demoable. Mock mode must never call Microsoft APIs.
- `lib/optimizer/*` are pure functions of a snapshot. A user is never double counted (disabled, then inactive, then duplicate or downgrade).
- Recharts SVG attributes cannot take CSS `var()`; resolve colors with `useChartColors()`.
- Write routes use `requireAdmin` (app role `LicenseOptimizer.Admin` plus a same-origin check), validate on the server, preview then confirm, and write an audit entry. Audit failures are logged and never turned into a 500 after a real change.
- In live mode sign-in headers are trusted only when `EASY_AUTH_ENABLED=true`.
- Never reduce below currently assigned seats; count only enabled, non-trial subscriptions toward the floor.
- Users missing from the usage report (new joiners, renamed UPN) or a concealed report mean activity is unknown, never inactive. Accounts younger than the inactivity window are never flagged.
- Renewal dates are calendar dates (00:00Z): compare and display them as UTC dates.

## Microsoft facts the code depends on

- Graph app-only, client credentials, scope `https://graph.microsoft.com/.default`: `/subscribedSkus` (purchased is `prepaidUnits.enabled`, assigned is `consumedUnits`), `/directory/subscriptions` (`nextLifecycleDateTime`, `isTrial`, `status`), `/users`, `getOffice365ActiveUserDetail`, `assignLicense`.
- Graph has no price or invoice data. `/users/{id}/licenseDetails` is delegated only; use `assignedLicenses`. `signInActivity` needs `AuditLog.Read.All` and Entra ID P1.
- Graph rolls `nextLifecycleDateTime` forward after a renewal, so the app stores the last value it saw per subscription to know which renewal just happened.
- The MCA billing subscription name does not equal the Graph subscription id, and `displayName` is null (use `productType`). The join is in `lib/billing/match.ts`: provisioning tenant, product, end date (UTC day, plus or minus one) and quantity, one to one, ambiguous means unmatched.
- Billing `nextLink` values are relative paths: resolve them against the ARM host and drop `api-version`.

Verify every endpoint, permission and licensing rule on learn.microsoft.com before changing it.
