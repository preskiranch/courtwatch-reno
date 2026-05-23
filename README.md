# CourtWatch Reno

CourtWatch Reno is a mobile-first PWA for choosing and following registered teams at the Jam On It / Exposure Basketball Events 2026 Reno Memorial Day Tournament.

It is an independent companion tracker and is not affiliated with Jam On It or Exposure Events. Official schedules and rulings come from tournament staff.

## What It Does

- Tracks the Exposure event `255539` for the 2026 Reno Memorial Day Tournament.
- Starts with no teams preselected.
- Lets you search registered team names, club names, divisions, and player names when roster/player data is available.
- Lets you follow or unfollow any registered team, then builds a unified schedule and alert feed from your choices.
- Shows dashboard, team selection, unified schedule, per-team court/bracket focus, game status, alerts, settings, and admin sync.
- Supports browser push notifications with VAPID.
- Keeps the last saved schedule visible when the source temporarily fails.
- Provides a Render Blueprint with web, API, worker, and Postgres.

## Monorepo

```text
apps/web       Next.js PWA
apps/api       Express REST API
apps/worker    Render background sync worker
packages/core  matching, sync helpers, source clients, seed data, tests
packages/db    Prisma client wrapper
prisma         schema and migrations
scripts        seed script
```

## Local Setup

```bash
npm ci
cp .env.example .env
npm run db:generate
npm run typecheck
npm run test:run
npm run build
```

Without `DATABASE_URL`, the API runs from built-in mock data. For persistent local data, run Postgres and set `DATABASE_URL`.

Example local Postgres:

```bash
docker run --name courtwatch-reno-postgres \
  -e POSTGRES_USER=courtwatch \
  -e POSTGRES_PASSWORD=courtwatch \
  -e POSTGRES_DB=courtwatch_reno \
  -p 5432:5432 -d postgres:16

npm run db:migrate
npm run db:seed
```

Run locally:

```bash
npm run dev:api
npm run dev
```

Open `http://localhost:3000`.

## Environment Variables

Copy `.env.example` and set real values in local shell or Render dashboard. Do not commit secrets.

Required for production:

- `DATABASE_URL`
- `WEB_BASE_URL` (Blueprint defaults to `https://courtwatch-reno-web.onrender.com`)
- `API_BASE_URL` (Blueprint defaults to `https://courtwatch-reno-api.onrender.com`)
- `NEXT_PUBLIC_API_BASE_URL` (Blueprint defaults to `https://courtwatch-reno-api.onrender.com`)
- `ADMIN_SECRET`
- `JWT_SECRET`
- `EXPOSURE_EVENT_ID=255539`
- `EXPOSURE_PUBLIC_FETCH_ALL_GAMES=false`
- `EXPOSURE_PUBLIC_REQUEST_DELAY_MS=125`
- `ENABLE_MOCK_ARSENAL=false`
- `ENABLE_MOCK_DATA=false`

Exposure API:

- `EXPOSURE_API_KEY`
- `EXPOSURE_SECRET_KEY`

Push notifications:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `PUSH_CONTACT_EMAIL`
- `EXPO_ACCESS_TOKEN` for future Expo support

Render automation:

- `RENDER_API_KEY` only if you later script Render API calls. Never commit it.

## Exposure API

CourtWatch prefers the official Exposure API when `EXPOSURE_API_KEY` and `EXPOSURE_SECRET_KEY` are configured. The API client signs requests with the documented `Timestamp` and `Authentication` headers and keeps credentials server-side only.

Team search is backed by Exposure teams. Player-name search uses the official Exposure Players endpoint when credentials and roster visibility allow it. The public-page fallback can discover teams, but it does not expose private roster/player data.

If credentials are missing, the backend can use a respectful public-page fallback for team discovery from:

- `https://basketball.exposureevents.com/255539/2026-reno-memorial-day-tournament/teams`
- `https://basketball.exposureevents.com/255539/2026-reno-memorial-day-tournament/schedule`
- Exposure's public `eventgames` and `bracket/{id}` endpoints referenced by that schedule page

The public fallback does not bypass authentication, does not scrape aggressively, and keeps existing saved data visible if source fetches fail. It fetches schedule/bracket data for followed-team divisions by default. Set `EXPOSURE_PUBLIC_FETCH_ALL_GAMES=true` only if you intentionally want a full public schedule sweep.

## Team Selection

The app now uses a single `My Teams` watchlist. It starts empty, and every followed team is added manually from the Teams screen.

Search supports:

- Team name
- Club/program name when provided by Exposure
- Division/grade/level
- Registered player name when Exposure roster/player data is available through API credentials

Follow a team through the API:

```bash
curl -X POST "$API_BASE_URL/api/teams/team-splash-4th/follow"
curl -X DELETE "$API_BASE_URL/api/teams/team-splash-4th/follow"
```

## Sync Worker

The worker calls the API admin sync endpoint.

```bash
API_BASE_URL=http://localhost:4000 ADMIN_SECRET=dev-secret npm run dev:worker
```

Behavior:

- Runs an immediate sync on startup.
- Polls every 60 seconds during May 23-25, 2026 active Reno tournament hours.
- Polls every 10-15 minutes outside active hours.
- Uses exponential backoff after failures.
- Preserves old saved data if the source fails.

Manual sync:

```bash
curl -X POST "$API_BASE_URL/api/admin/sync-now" \
  -H "x-admin-secret: $ADMIN_SECRET"
```

## Seed Source Data

```bash
npm run db:seed
```

`npm run db:seed` runs the same sync path as production. It fetches current teams from Exposure/API or the respectful public fallback and removes any old demo games or demo change events from the database.

The app only uses built-in mock games when `ENABLE_MOCK_DATA=true` and no source teams are available. Do not enable mock data for production tournament use.

No teams are followed by default; use the Teams screen to choose them. When the database-backed sync can read the public teams page, mock Arsenal teams are skipped unless `ENABLE_MOCK_ARSENAL=true`; this keeps production data aligned with teams currently visible from the source.

Following a team triggers a limited schedule sync for that team's division so the schedule tab and focused-team bracket panel can populate without waiting for the next worker poll.

## Push Notifications

Generate VAPID keys:

```bash
npx web-push generate-vapid-keys
```

Set these in Render:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` with the same public key
- `PUSH_CONTACT_EMAIL=mailto:you@example.com`

The PWA registers `/sw.js` and stores push subscriptions through `POST /api/push/subscribe`. Notification logs use dedupe keys so repeated source data does not resend identical updates.

## API Routes

- `GET /api/health`
- `GET /api/events/current`
- `GET /api/programs`
- `GET /api/programs/:programId`
- `POST /api/programs/:programId/aliases`
- `DELETE /api/programs/:programId/aliases/:aliasId`
- `GET /api/teams?search=`
- `GET /api/teams/:teamId`
- `POST /api/teams/:teamId/follow`
- `DELETE /api/teams/:teamId/follow`
- `GET /api/players?search=`
- `GET /api/games`
- `GET /api/games?scope=division&division=division-1278469`
- `GET /api/games/:gameId`
- `GET /api/dashboard`
- `GET /api/alerts`
- `POST /api/push/subscribe`
- `DELETE /api/push/unsubscribe`
- `GET /api/settings/notification-preferences`
- `PATCH /api/settings/notification-preferences`
- `POST /api/admin/sync-now`

## Render Deployment

1. Create a GitHub repository named `courtwatch-reno`.
2. Push this repo to `main`.
3. Confirm the `render.yaml` repo URLs point to `https://github.com/preskiranch/courtwatch-reno`.
4. In Render, choose **New > Blueprint** and connect the GitHub repository.
5. Render creates:
   - `courtwatch-reno-web`
   - `courtwatch-reno-api`
   - `courtwatch-reno-sync-worker`
   - `courtwatch-reno-db`
6. Set environment variables marked `sync: false`. The API service generates `ADMIN_SECRET`, and the worker references that generated value from the API service.
7. Deploy. The API build applies migrations with `npm run db:migrate`.
8. After first deploy, run `npm run db:seed` from a Render shell or trigger `POST /api/admin/sync-now`.

The Blueprint uses `npm ci --include=dev` in build commands so TypeScript, Prisma CLI, and other build-time tools are available even though the deployed services run with `NODE_ENV=production`.

Render service URLs should be wired like:

- `WEB_BASE_URL=https://courtwatch-reno-web.onrender.com`
- `API_BASE_URL=https://courtwatch-reno-api.onrender.com`
- `NEXT_PUBLIC_API_BASE_URL=https://courtwatch-reno-api.onrender.com`

## GitHub

If GitHub CLI is available:

```bash
git init
git branch -M main
git add .
git commit -m "Build CourtWatch Reno tournament tracker"
gh repo create courtwatch-reno --private --source=. --remote=origin --push
```

If the repo already exists:

```bash
git remote add origin git@github.com:preskiranch/courtwatch-reno.git
git push -u origin main
```

## Checks

```bash
npm run typecheck
npm run lint
npm run test:run
npm run build
```

CI runs type checking, linting, tests, and build verification on pushes and pull requests to `main`.
