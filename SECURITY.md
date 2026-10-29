# Security policy

## Reporting a vulnerability

Please do **not** open a public issue for a security problem. Use GitHub's private vulnerability reporting ("Security" tab, "Report a vulnerability") on this repository. Include what you found, how to reproduce it, and the impact. You will get an acknowledgement as soon as the maintainer can respond; this is a volunteer project with no guaranteed response time.

## Scope notes

This application can read user and license data from a Microsoft 365 tenant and, when enabled, change licenses and subscription settings. Areas that deserve extra care in review:

- the `requireAdmin` gate and the same-origin check on write routes
- trusting sign-in headers only when `EASY_AUTH_ENABLED=true`
- secret handling (client secrets belong in Key Vault references, never in the repository)
- the scoped `Mail.Send` design (Exchange RBAC for Applications, never an Entra `Mail.Send` grant)

## Hardening checklist for operators

- Keep App Service Authentication on and require user assignment on the sign-in app.
- Use a certificate or federated credential instead of a client secret for production, and rotate secrets before they expire.
- Limit the admins group to the few people who may change licenses or billing.
- Review the audit log in Settings regularly.
