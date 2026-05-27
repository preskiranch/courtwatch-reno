# Court Watch AAU Agent Rules

Court Watch AAU is a tournament companion app that currently supports the 2026 Reno Memorial Day Tournament. Treat schedule accuracy, secret handling, and mobile usability as product-critical.

## Guardrails

- Never commit Exposure API keys, Render tokens, VAPID private keys, database passwords, JWT secrets, or admin secrets.
- Keep Exposure credentials only in API or worker code. Browser bundles must never import server-only source clients.
- Preserve the default program watchlist: Arsenal and Splash City. If Arsenal has zero matches, keep monitoring and show the zero-state message.
- Prefer exact and normalized program matching before fuzzy matching. Add tests for any matcher changes and protect against false positives.
- Keep the public-page fallback respectful: no auth bypassing, no aggressive polling, cache where possible, and keep old saved data visible on source failure.
- Use `America/Los_Angeles` for tournament display times unless a user setting overrides it.
- Keep the mobile PWA first. Verify tap targets, bottom navigation, and readable court/time/opponent data on phone-sized viewports.
- Use Prisma migrations for schema changes and keep `render.yaml` deployable.
- Add or update tests when changing sync, matching, notification dedupe, game change detection, or dashboard response shape.

## Commands

- Install: `npm ci`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Test: `npm run test:run`
- Build: `npm run build`
- Generate Prisma: `npm run db:generate`
- Apply migrations: `npm run db:migrate`
- Seed mock data: `npm run db:seed`

## Architecture

- `apps/web`: Next.js mobile-first PWA.
- `apps/api`: Express REST API.
- `apps/worker`: Render worker that triggers syncs.
- `packages/core`: shared matching, source clients, change detection, seed data, and typed service helpers.
- `packages/db`: Prisma client wrapper.
- `prisma`: schema and migrations.
