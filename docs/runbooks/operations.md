# Court Watch AAU Operations Runbook

This runbook is for production incidents affecting the web service, API, sync
worker, Exposure relay, PostgreSQL, or notification delivery.

## Service Map

| Service        | Render name                   | Primary probe                |
| -------------- | ----------------------------- | ---------------------------- |
| Web            | `courtwatch-reno-web`         | `/api/health`                |
| API            | `courtwatch-reno-api`         | `/api/health/ready`          |
| Sync worker    | `courtwatch-reno-sync-worker` | logs and API sync metrics    |
| Exposure relay | `courtwatch-exposure-relay`   | `/health`                    |
| Database       | `courtwatch-reno-db`          | API readiness database check |

Never paste secrets, authorization headers, reset tokens, push subscriptions, or
database URLs into tickets or chat.

## Severity

- **SEV-1:** site unavailable, database unavailable, widespread data corruption,
  authentication bypass, or leaked secret.
- **SEV-2:** sync is stale for active tournaments, notification delivery is
  broadly failing, one production service repeatedly crashes, or core pages fail.
- **SEV-3:** one event/provider is stale, isolated notification failures, elevated
  latency, or a non-critical feature is unavailable.

## First Five Minutes

1. Open `https://courtwatch-reno-api.onrender.com/api/health/live`.
2. Open `https://courtwatch-reno-api.onrender.com/api/health/ready`.
3. Check the latest deploy and runtime logs for all four services.
4. Confirm whether the issue affects one tournament, one provider, or every
   request.
5. Preserve the last successful data. Do not delete events, games, queue rows, or
   sync history as a first response.

## Reading API Health

`/api/health/live` returning `200` means the process can serve HTTP. It does not
prove the database or source is usable.

`/api/health/ready` fields:

- `status=ready`: database and operational metric checks passed.
- `status=degraded`: core API can serve, but one or more sync/queue signals need
  attention.
- `status=not_ready` with `503`: database access failed; Render should remove the
  instance from traffic.
- `checks.synchronization.staleRunning > 0`: a sync has remained running beyond
  the stale threshold.
- `checks.synchronization.failedLastHour > 0`: inspect worker/API sync errors.
- `checks.notifications.retrying > 0`: transient failures are being retried.
- `checks.notifications.deadLetter > 0`: delivery exhausted its retry budget and
  requires investigation.

## Web or API Unavailable

1. Confirm API liveness and readiness separately.
2. If liveness fails, inspect the service's last exit reason and memory graph.
3. If readiness fails only on the database check, inspect PostgreSQL availability,
   connection limits, and recent migrations.
4. If the latest deploy caused the incident, roll back to the prior healthy deploy
   in Render.
5. Verify web, API readiness, and one catalog request after recovery.

Do not repeatedly restart an instance without identifying the exit reason; this
can hide a migration, memory, or configuration failure.

## Active Tournament Is Stale

1. Read `/api/health/ready` and `/api/sync-health`.
2. Confirm the worker is running and has completed a poll recently.
3. Inspect logs for the event ID and determine whether the failure is:
   - provider timeout or rate limit;
   - relay connectivity;
   - parser/contract change;
   - database failure;
   - event lease already held by another instance.
4. Open the provider's official page to confirm data actually exists.
5. Trigger one authenticated manual sync only after the worker's current pass has
   finished:

   ```bash
   curl -X POST "$API_BASE_URL/api/admin/sync-now" \
     -H "x-admin-secret: $ADMIN_SECRET"
   ```

6. Confirm a successful `sync_run` and the expected API response.

Never mark missing upstream data as an empty tournament and never manufacture a
score, opponent, record, or placement.

## Exposure Relay Failure

1. Check the relay `/health` endpoint.
2. Confirm `EXPOSURE_RELAY_BASE_URL` and the shared token are configured together.
3. Inspect relay logs for timeout, response-size rejection, forbidden host, or
   delegate failure.
4. Check the official Exposure site from a normal browser.
5. Allow API fallback behavior to retain the last successful data while the relay
   recovers.

Repeated size-limit failures indicate a provider payload or endpoint contract
change. Review the endpoint before raising limits; do not remove the cap.

## Notification Backlog or Missing Alerts

1. Read readiness queue counts.
2. Inspect `notification_log` by `status` and recent `error_message` values.
3. Confirm VAPID configuration and whether the affected user still has a valid
   push subscription.
4. Verify the user's notification preference allowed the event category.
5. Confirm only one row exists for the expected dedupe key.
6. Allow `pending` and `retrying` rows to follow their scheduled retry time.
7. Investigate `dead_letter` rows individually; do not bulk mark them sent.

An expired push subscription is terminal for that subscription. The service may
remove it after a terminal provider response so repeated attempts do not create
noise.

## Duplicate Notifications

1. Compare the two notification dedupe keys.
2. If keys differ, inspect whether two distinct source changes were normalized to
   equivalent user text.
3. If keys match, verify the database unique constraint and delivery claim lease.
4. Confirm only one API deployment version is active after a rollout.
5. Add a regression test before changing dedupe normalization.

## Database Incident

1. Treat database unavailability as SEV-1 when it affects all API instances.
2. Check connections, CPU, storage, and long-running queries in Render.
3. Stop manual sync requests if they increase pressure.
4. Do not run destructive migration or cleanup commands during diagnosis.
5. Restore service, confirm readiness, then allow the worker to resume its normal
   retry schedule.
6. Validate row counts and the latest successful sync before declaring recovery.

## Deployment Procedure

1. Require all GitHub checks to pass.
2. Review Prisma migrations for forward compatibility and lock risk.
3. Merge to `main`; Render deploys only after checks pass.
4. Render runs migrations before starting the new API revision.
5. Wait for readiness to pass.
6. Verify the web health endpoint, API readiness, event catalog, and one known
   tournament.
7. Confirm the scheduled smoke workflow or run it manually.
8. Watch sync failures, dead letters, response latency, and process memory during
   the observation window.

## Rollback Procedure

1. In Render, open the affected service and select the last known healthy deploy.
2. Roll back the API, worker, relay, and web together when their contracts changed
   in the same release.
3. Do not reverse a database migration until its data compatibility is understood.
   Prefer application rollback with a backward-compatible schema.
4. Verify API readiness and production smoke checks.
5. Record the failed commit, symptom, root cause, and required regression test.

## Post-Incident Requirements

Every production defect must produce:

1. A root-cause statement, not only the visible symptom.
2. A permanent fix at the correct architectural boundary.
3. A regression test that failed before the fix.
4. Verification across all supported tournaments, not just the reported example.
5. An update to this runbook when diagnosis or recovery was unclear.

## Recommended Alerts

Configure alerts for:

- API readiness returning `503` for two consecutive checks.
- Any service crash loop.
- `staleRunning > 0` for more than one check interval.
- Active-tournament `latestSuccessAt` older than the active freshness objective.
- `deadLetter > 0`.
- A growing retry queue across three dispatch intervals.
- PostgreSQL storage, CPU, or connection use above 80% for a sustained interval.
- Court Watch core smoke failure. The separate Exposure source-connectivity job
  identifies an upstream provider outage and does not imply that the web, API,
  database, or persisted event catalog is unavailable.

## Recovery Completion Checklist

- [ ] Web opens on mobile and desktop
- [ ] API liveness is `200`
- [ ] API readiness is `ready` or an understood `degraded`
- [ ] Event catalog loads
- [ ] Registered teams remain event-scoped
- [ ] Schedule and records match the official source
- [ ] No premature final placements appear
- [ ] Existing followed teams remain intact
- [ ] Notification queue is stable
- [ ] Worker completed a successful pass
- [ ] No service is crash-looping
