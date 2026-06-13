# CourtVision Scorekeeper MVP

CourtVision Scorekeeper is a mobile-first PWA MVP for AI camera-assisted basketball scoring. It lets a user configure solo, one-team, or two-team play, define target score and rules, calibrate 2PT/3PT court zones, mark the hoop, run a live camera preview where browser permission is available, and test the full scoring flow with debug/manual shot events.

## What Works Now

- Home, setup, camera setup, calibration, game, game-over, and history screens.
- Solo, one-team, and two-team modes with editable team names and colors.
- Target score, win-by-2, 2PT/3PT toggles, optional shot clock value, and game-ending buzzer trigger.
- Calibration profiles saved in browser local storage with hoop bounds, rim center, 2PT polygons, 3PT polygons, and optional out-of-bounds polygons.
- Point-in-polygon scoring logic for deterministic 2PT/3PT/unknown zone detection.
- Scoreboard, shot log, shot chart, undo, manual correction, pending confirmation for unknown team/zone/result/low-confidence events.
- Debug shot simulator for made 2PT, made 3PT, miss, unknown team, and unknown zone paths.
- Browser camera preview with overlay when permission is available.
- Session history saved locally and JSON export for game summaries.
- Unit tests for calibration validation, point-in-polygon, shot value calculation, score updates, undo, win condition, win-by-2, team color fallback, debug events, missed shots, unknown team/zone, and buzzer trigger.

## AI Camera Integration

The repository was searched for the requested existing Tool Check-In camera terms:

- `Tool Check In`
- `tool-check-in`
- `ai camera`
- `AICamera`
- `CameraAI`
- `VisionCamera`
- `camera scanner`
- `camera analyzer`
- `object detection`
- `frame processor`

No exact reusable AI camera tool was present in this repo. The MVP therefore adds a pluggable interface layer in `packages/core/src/courtvision-vision.ts` rather than hard-coding a duplicate camera pipeline.

Integration points:

- `CameraFrameProvider` supplies frames from a phone camera, test video, or image source.
- `HoopDetector` detects or stores the hoop/rim/backboard region.
- `BallTracker` tracks basketball position across frames.
- `PlayerTracker` tracks players and optional sampled jersey colors.
- `TeamColorClassifier` assigns shots to teams based on calibrated colors.
- `ShotAttemptDetector` finds likely shot releases from ball trajectory.
- `MadeShotDetector` decides made/missed from hoop-region crossing and confidence.
- `ShotScoringEngine` converts detector output into `ShotEvent` objects consumed by the UI.

The UI does not depend on low-level CV code. It consumes `ShotEvent`-like data and routes uncertain events through confirmation controls.

## Local Development

```bash
npm ci
npm run build --workspace @courtwatch/core
npm run test:run --workspace @courtwatch/core
npm run typecheck --workspace @courtwatch/web
npm run dev
```

Open `http://localhost:3000`.

## Render Deployment

This MVP deploys as a single Render web service. It does not require the legacy API, worker, or Postgres services because calibration profiles, settings, and game history are stored in browser local storage.

Use the dedicated `render.courtvision.yaml` Blueprint file. In Render's Blueprint setup, set the Blueprint Path to:

```text
render.courtvision.yaml
```

Render will run:

```bash
npm ci --include=dev && npm run build --workspace @courtwatch/core && npm run build --workspace @courtwatch/web
```

and then start the app with:

```bash
npm run start --workspace @courtwatch/web
```

The Blueprint uses Render's free web instance type. Set `NEXT_PUBLIC_SITE_URL` and `WEB_BASE_URL` to the final Render URL or custom domain. The default Blueprint values point to `https://courtvision-scorekeeper-web.onrender.com`.

Do not attach this service to the existing root `render.yaml`; that file remains the legacy Court Watch AAU API/web/worker Blueprint. Keeping CourtVision in `render.courtvision.yaml` prevents a single Blueprint from managing unrelated resources.

The CourtVision Blueprint sets `NEXT_PUBLIC_APP_TARGET=courtvision`. Leave that variable unset for the existing Court Watch AAU website so the original homepage remains the default.

## Current Limitations

- Real ball, player, hoop, shot attempt, and made-shot detection are placeholders by design.
- Camera instability and zoom warnings are static guidance in this MVP.
- Highlight clip saving, voice announcements, and scoreboard image sharing are not implemented.
- Calibration editing is intentionally simple: tap to place hoop or append polygon points, or use the default template.
- Stats and profiles are local to the browser until a persistence backend is wired in.

## Legacy Project Notes

# Court Watch AAU

Court Watch AAU is a mobile-first PWA for choosing and following registered teams across AAU basketball tournaments, including the Jam On It / Exposure Basketball Events 2026 Reno Memorial Day Tournament.

It is an independent companion tracker and is not affiliated with Jam On It or Exposure Events. Official schedules and rulings come from tournament staff.

## What It Does

- Tracks the Exposure event `255539` for the 2026 Reno Memorial Day Tournament.
- Starts with no teams preselected.
- Lets you search registered team names, club names, and divisions.
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
- `NEXT_PUBLIC_SITE_URL` (set to the public website URL for metadata, robots, and sitemap)
- `WEB_ALLOWED_ORIGINS` (comma-separated extra browser origins allowed to call the API)
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

Optional free account password reset:

- `RESEND_API_KEY`
- `PASSWORD_RESET_FROM_EMAIL`, defaulting to `Court Watch AAU <no-reply@courtwatchaau.com>`
- `PASSWORD_RESET_EXPOSE_TOKEN=false` in production

Render automation:

- `RENDER_API_KEY` only if you later script Render API calls. Never commit it.

## Exposure API

Court Watch AAU prefers the official Exposure API when `EXPOSURE_API_KEY` and `EXPOSURE_SECRET_KEY` are configured. The API client signs requests with the documented `Timestamp` and `Authentication` headers and keeps credentials server-side only.

Team search is backed by Exposure teams. Player-name search is intentionally disabled because the public fallback does not expose private roster/player data and the official players endpoint requires Exposure API access.

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
- Discovers approved public Exposure tournaments on startup and then on `TOURNAMENT_DISCOVERY_INTERVAL_HOURS` (default: 6 hours).
- Looks ahead `TOURNAMENT_DISCOVERY_WINDOW_DAYS` (default: 183 days) for public-source tournaments.
- Tracks built-in Exposure organizer sources including Jam On It, Grassroots 365, GSG Hoops, BAMTOURNAMENTS, Touch Shooting Premiere Events, Hoop 121, NorCal Sports TV, and Bay Area Stars Academy.
- Also imports the full future public Exposure Basketball directory as metadata-only tournament listings so thousands of events can appear without scraping every team page at once. Team, schedule, records, and results sync through the existing Exposure flow when a tournament has public data and is selected or due for sync.
- Polls every 60 seconds during active tournament dates/hours for any tracked event.
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

## Free Account Sync

Saved teams remain per device by default. Users can create a free account from Settings to sync followed teams across their phone, tablet, and computer. Signing in uploads that device's saved teams into the account; it does not erase the device copy.

Forgot password uses `POST /api/auth/forgot-password` and `POST /api/auth/reset-password`. Configure Resend with `RESEND_API_KEY`; the app sends reset emails from `Court Watch AAU <no-reply@courtwatchaau.com>` unless `PASSWORD_RESET_FROM_EMAIL` overrides it. Do not enable `PASSWORD_RESET_EXPOSE_TOKEN` in production.

Resend setup for `courtwatchaau.com`:

1. In Resend, add the sending domain `courtwatchaau.com`.
2. Copy the DNS records Resend generates for the domain, including DKIM and SPF/return-path records, into the DNS provider for `courtwatchaau.com`.
3. In Resend, click **Verify DNS Records** and wait until the domain status is verified.
4. Create a Resend API key with email-sending access.
5. In Render, set `RESEND_API_KEY` on `courtwatch-reno-api`.
6. Keep `PASSWORD_RESET_FROM_EMAIL=Court Watch AAU <no-reply@courtwatchaau.com>` and redeploy the API service.

If reset emails do not arrive, check the `courtwatch-reno-api` logs for `Password reset email was not sent`. The log includes whether Resend is configured, which sender was used, the provider status code, and the provider error without printing reset tokens.

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
- `GET /api/accounts/stats`
- `GET /api/auth/me`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/account/sync-followed-teams`
- `GET /api/programs`
- `GET /api/programs/:programId`
- `POST /api/programs/:programId/aliases`
- `DELETE /api/programs/:programId/aliases/:aliasId`
- `GET /api/teams?search=`
- `GET /api/teams/:teamId`
- `POST /api/teams/:teamId/follow`
- `DELETE /api/teams/:teamId/follow`
- `GET /api/presence`
- `POST /api/presence/heartbeat`
- `GET /api/games`
- `GET /api/games?scope=division&division=division-1278469`
- `GET /api/courts`
- `GET /api/games/:gameId`
- `GET /api/dashboard`
- `GET /api/alerts`
- `POST /api/push/subscribe`
- `DELETE /api/push/unsubscribe`
- `GET /api/settings/notification-preferences`
- `PATCH /api/settings/notification-preferences`
- `POST /api/admin/sync-now`

## Social Outreach Prep

Court Watch AAU includes a manual outreach assistant for recent completed tournaments. It prepares an outreach CSV, message drafts, and branded achievement image cards, but it does not send automated Instagram or TikTok DMs.

```bash
npm run outreach:generate
```

Examples:

```bash
npm run outreach:generate -- --event=255539 --max-teams=50
npm run outreach:generate -- --days=30 --max-teams=0
```

Generated files are written to `outreach/generated/`, which is ignored by git. Full instructions are in [docs/social-outreach.md](docs/social-outreach.md).

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
- `NEXT_PUBLIC_SITE_URL=https://courtwatch-reno-web.onrender.com`

## Official Website And Custom Domain

The web app includes domain-ready public pages:

- `/install`
- `/support`
- `/privacy`
- `/terms`
- `/sitemap.xml`
- `/robots.txt`

Recommended domain: `courtwatchaau.com`.

To connect a custom domain in Render:

1. Buy the domain from a registrar. Cloudflare Registrar is a good low-cost option because it sells domains at wholesale registry pricing when the domain is eligible.
2. In Render, open `courtwatch-reno-web`.
3. Go to **Settings > Custom Domains**.
4. Add both:
   - `courtwatchaau.com`
   - `www.courtwatchaau.com`
5. Copy the DNS records Render shows.
6. Add those records at the domain registrar or DNS host.
7. Wait for Render to issue HTTPS certificates.
8. Update Render environment variables:
   - Web service: `NEXT_PUBLIC_SITE_URL=https://app.courtwatchaau.com` until the bare domain certificate is issued, then optionally switch to `https://courtwatchaau.com`
   - API service: `WEB_ALLOWED_ORIGINS=https://courtwatch-reno-web.onrender.com,https://courtwatchaau.com,https://www.courtwatchaau.com,https://app.courtwatchaau.com`
   - API service: set `WEB_BASE_URL=https://app.courtwatchaau.com` while the branded app subdomain is the primary live URL.
9. Redeploy the web and API services.

Keep the Render URL working during the transition so families with the older shared link can still open the tracker.

## GitHub

If GitHub CLI is available:

```bash
git init
git branch -M main
git add .
git commit -m "Build Court Watch AAU tournament tracker"
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
