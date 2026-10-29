# Changelog

## 1.0.0

First public release.

- Dashboard: overview, license inventory, SKU detail with renewal windows, optimization recommendations, 12-month forecast, settings and audit log
- Optimization rules: unassigned seats, disabled accounts, inactive users, duplicate licenses, tier consolidation
- Actions (admin only): remove licenses from disabled or inactive users, reduce seats and switch auto-renew on Microsoft Customer Agreement subscriptions
- Daily renewal reminder emails from one shared mailbox (Exchange RBAC for Applications)
- Guided setup wizard (`setup.sh`) and phased, idempotent deployment (`deploy/deploy.sh`)
- Generic price book (USD list-price estimates) with `PRICE_OVERRIDES`; configurable currency, inactivity window and reminder time zone
- Synthetic demo data; no Microsoft calls in mock mode
