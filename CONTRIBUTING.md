# Contributing

Thanks for helping. Bug reports, fixes, new optimization rules, price-book updates and documentation improvements are all welcome.

## Ground rules

- Open an issue first for anything larger than a small fix, so the approach can be agreed.
- Never commit real tenant data, user names, invoices, secrets or screenshots of a real tenant. Mock data is synthetic; keep it that way.
- Every new data source needs a mock in `lib/data/mock.ts`. Mock mode must never call Microsoft APIs.
- Verify any Graph or Azure endpoint, permission or licensing rule on learn.microsoft.com and cite it in the pull request.
- Anything that writes (license removal, billing, mail) must be admin-gated, validated on the server, previewed, confirmed and audited.
- Keep documentation and comments free of em dashes; use commas, semicolons or hyphens.

## Local development

```bash
npm install
cp .env.example .env.local   # DATA_MODE=mock, DEV_ROLE=admin to see action buttons
npm run dev
```

Before opening a pull request:

```bash
npx tsc --noEmit
DATA_MODE=mock npm run build
bash -n setup.sh deploy/deploy.sh
```

## Pull requests

Describe what changed and why, how you tested it (mock mode is fine for UI work), and any Microsoft documentation the change relies on. By contributing you agree that your contribution is released under the MIT License.
