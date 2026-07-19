# Court Watch AAU Production Readiness

Last reviewed: 2026-07-18

This document records the production architecture, reliability guarantees, major
engineering controls, and deliberate deferrals for Court Watch AAU. Operational
response procedures are in [runbooks/operations.md](runbooks/operations.md).

## Executive Summary

Court Watch AAU is a mobile-first tournament companion built as a TypeScript
monorepo. The production path consists of a Next.js PWA, an Express API, a
continuous synchronization worker, an authenticated Exposure relay, PostgreSQL,
and multiple public tournament-provider adapters.

The application is designed around one rule: source failures may make data stale,
but they must not replace trusted persisted data with guesses or empty results.
Synchronization, notification delivery, account sessions, presence, and
deployment readiness are durable or coordinated through PostgreSQL so the API and
worker can scale beyond one process without creating duplicate work.

## Architecture

```text
Browser / installed PWA
        |
        v
Next.js web service ---- Express API ---- PostgreSQL
                              |                ^
                              |                |
                              +---- sync worker+
                              |
                              +---- authenticated Exposure relay ---- Exposure
                              |
                              +---- provider adapters ---------------- other sources
                              |
                              +---- Web Push / Resend
```

### Components

| Component                | Responsibility                                                                | Production control                                                                        |
| ------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `apps/web`               | PWA, navigation, local/offline cache, API queries                             | Route error/loading boundaries, bounded retries, deferred optional poster code            |
| `apps/api`               | REST API, accounts, follows, dashboard, alerts, synchronization orchestration | Validation, rate limiting, redacted structured logs, revocable sessions, readiness probes |
| `apps/worker`            | Prioritized discovery and tournament synchronization                          | Retry budget, exponential backoff, jitter, per-event timeout, graceful drain              |
| `apps/exposure-relay`    | Regionally reachable, authenticated Exposure proxy                            | Host allowlist, request/response size limits, timeout, abort propagation, graceful drain  |
| `packages/core`          | Provider clients, matching, change detection, domain rules                    | Unit and regression tests for critical data rules                                         |
| `packages/db` / `prisma` | Persistence and migration contract                                            | Constraints, indexes, leases, durable notification queue                                  |

## Non-Negotiable Data Invariants

1. Never fabricate tournament teams, games, scores, records, or placements.
2. Never declare a champion until an official final result establishes placement.
3. Never delete the last successful schedule because a provider is unavailable.
4. Tournament follows are event-specific; global favorite-team watches are a
   separate concept.
5. Every user-owned operation is resolved from a validated account session or a
   device-scoped client identifier.
6. Provider credentials remain server-side and are redacted from logs.
7. A notification dedupe key is unique per user, change, and channel.
8. Synchronization for one event cannot write data into another event.
9. Data refreshes are coordinated across API instances with database leases.
10. Failed notification delivery remains visible and retryable; it is never
    silently treated as delivered.

## Implemented Improvements

### Authentication and authorization

- Account sessions are persisted as hashed, revocable server-side records.
- Logout and password reset revoke active sessions.
- Ownership checks are centralized around resolved session claims.
- Sensitive headers and credential-shaped request fields are removed from logs.
- Password reset tokens remain hashed at rest and are never exposed in production.

Impact: **High**. A stolen or obsolete bearer token can be invalidated, and
authorization no longer relies only on a self-contained token lifetime.

### Synchronization and provider resilience

- Cross-instance event leases prevent duplicate refreshes.
- Same-process requests coalesce around one active event refresh.
- Active events, near-term team lists, passive events, and discovery use separate
  freshness and priority rules.
- Worker calls have bounded timeouts, retry limits, exponential backoff, and
  jitter.
- Systemic failures reduce pressure on the source instead of causing a retry
  storm.
- Existing persisted data survives all upstream failures.
- Relay requests enforce an origin allowlist and bounded request and response
  memory.

Impact: **High**. This removes duplicate source traffic, limits cascading
failures, and makes horizontal API scaling safe.

### Notification delivery

- Change events are fanned out into durable notification-log rows.
- Workers claim due rows with leases before sending.
- Failed sends use exponential retry scheduling and a maximum attempt count.
- Permanently failed messages move to `dead_letter` for inspection.
- Preference checks occur before queue insertion.
- Unique dedupe keys prevent repeat delivery.
- Dispatch passes are serialized within each API process and drained on shutdown.

Impact: **High**. Notifications are at-least-once attempted with effectively-once
user delivery under the dedupe contract, rather than best-effort fire-and-forget.

### Health and observability

- `/api/health/live` reports process liveness without dependencies.
- `/api/health/ready` verifies database access before Render sends traffic.
- Readiness includes queue and sync metrics without making non-critical metric
  collection an availability dependency.
- Slow or failing requests are emitted as structured logs.
- Sync freshness, running/stale jobs, recent failures, pending retries, and dead
  letters are visible in the readiness response.
- A scheduled production smoke test validates the web, API, catalog, and relay
  path.

Impact: **High**. Deployments and incidents can distinguish a dead process, an
unavailable database, a stale source, and a notification backlog.

### Deployment and CI

- Production uses Node.js 22 consistently.
- Pull requests and pushes run formatting/lint checks, type checking, tests,
  Prisma validation, production dependency audit, and builds.
- Dependabot monitors npm and GitHub Actions dependencies.
- Render only auto-deploys revisions whose GitHub checks pass.
- Database migrations run as a pre-deploy command.
- Render health checks gate traffic on API readiness.
- Services receive shutdown windows long enough to drain active work.
- Scheduled smoke tests detect production regressions after deployment.

Impact: **High**. Invalid schema, vulnerable production dependencies, failing
tests, and non-ready instances are blocked before receiving production traffic.

### Horizontal scaling readiness

- Synchronization leases, notification leases, account sessions, and presence are
  shared through PostgreSQL.
- Presence fails open to a bounded in-memory implementation if optional presence
  persistence is temporarily unavailable.
- API and worker shutdown paths drain active operations.

Impact: **Medium to High**. Additional API instances no longer disagree about
presence or repeat expensive synchronization work.

### Frontend performance and recovery

- Query retries are bounded and polling is visibility-aware.
- Route loading and error boundaries prevent a failed request from blanking the
  application.
- The optional result-poster generator is dynamically loaded.
- The Court Watch production target excludes unrelated CourtVision application
  code through build aliases.
- Cached successful tournament data remains available during transient outages.

Impact: **Medium**. Initial JavaScript and recovery behavior improve without a
risky rewrite of the mature tournament UI.

## Reliability Model

### Source consistency

Provider reads are converted to normalized domain records, compared with the last
successful snapshot, and persisted transactionally. Empty or failed upstream
responses do not automatically mean an event has no data. A source update becomes
visible only after a successful sync.

### Delivery semantics

- Sync: single active writer per event lease, idempotent upserts, last good data
  retained.
- Notifications: durable queue, leased delivery, retries, unique dedupe key.
- Presence: shared TTL rows, with a non-critical memory fallback.
- Deployments: checks-pass trigger, migrations before start, readiness before
  traffic, smoke verification after release.

## Performance and Scale Expectations

The current PostgreSQL-coordinated design is appropriate for the present traffic
and a substantial increase in concurrent users because expensive work is bounded
by event leases rather than request volume. The API remains stateless apart from
the database and can be replicated.

Expected measurable effects compared with the previous design:

- Duplicate same-event synchronization per API cluster: reduced to approximately
  one active operation per lease window.
- Notification loss on transient push failure: replaced by bounded automatic
  retries and dead-letter visibility.
- Overlapping notification timer work per API process: eliminated.
- Unbounded relay response memory: capped by configuration.
- Deployments accepting traffic before database readiness: eliminated.
- Presence disagreement between API instances: eliminated while PostgreSQL is
  available.

Exact latency and throughput claims require production traffic baselines. The
scheduled smoke test and readiness metrics establish the foundation for collecting
those baselines without inventing numbers.

## Deferred Recommendations

These items are intentionally not implemented in this review.

### Next.js transitive PostCSS advisory

Reason: **upstream version pin with no runtime exposure in Court Watch**. The
current stable Next.js release pins PostCSS 8.4.31, which npm reports for a
moderate CSS-stringification XSS advisory. Court Watch neither accepts nor
stringifies user-supplied CSS, so the vulnerable path is not exposed by the
application. npm's proposed remediation downgrades Next.js by multiple major
versions, and a workspace override does not replace Next.js's exact private
dependency. Dependabot and the production audit will continue monitoring this;
upgrade as soon as stable Next.js consumes PostCSS 8.5.10 or newer.

### Redis and a dedicated job broker

Reason: **cost and current-load ROI**. PostgreSQL leases and queue rows already
provide durability and cross-instance coordination. Add Redis or a managed broker
when queue claim latency, presence heartbeat writes, or database CPU becomes a
measured bottleneck. Suggested trigger: sustained notification backlog above one
dispatch interval, presence writes materially affecting database latency, or more
than a few dozen continuously active API/worker instances.

### Full OpenTelemetry and third-party APM

Reason: **external vendor decision**. Structured logs and operational health
metrics are implemented. Add OpenTelemetry traces after selecting a telemetry
backend and defining retention/cost policy. Instrument provider fetch, sync,
database, and push-delivery spans first.

### Dedicated staging and percentage canary environment

Reason: **additional Render resources and account cost**. CI, pre-deploy
migrations, readiness gating, health checks, and post-deploy smoke tests are in
place. A true canary needs duplicated infrastructure and traffic routing outside
this repository. Add it before a major traffic campaign or provider expansion.

### Automatic rollback controller

Reason: **platform/API credential dependency**. Render retains prior deploys for
manual rollback and does not expose repository-only declarative automatic rollback
rules. A controller could call the Render API after smoke failure, but it would
need a privileged production token in GitHub. Until that risk is accepted, use the
documented rollback procedure.

### MFA and mandatory email verification

Reason: **product flow and deliverability dependency**. Session revocation and
password-reset security are complete. MFA and verification require UX, recovery,
support, and email-deliverability policy decisions. They should be added before
accounts store payment, roster, or other sensitive personal data.

### Complete rewrite of the main React application

Reason: **high regression risk with low immediate user value**. The primary app is
large, but critical optional code is split and the mature interaction behavior is
covered by existing tests. Continue extracting one feature at a time only after
adding component-contract tests around that feature.

### One-second provider propagation

Reason: **upstream capability**. Immediate propagation is only possible when a
provider offers a reliable webhook or event stream. Polling cannot guarantee one
second freshness without violating source limits and increasing failure risk. The
current worker prioritizes active events and applies the shortest responsible
polling interval configured for the provider.

## Review Checklist

- [x] Runtime and production dependencies aligned
- [x] Server-side revocable sessions
- [x] Durable notification retries and dead letters
- [x] Cross-instance sync coordination
- [x] Shared presence for horizontal API scaling
- [x] Liveness/readiness and operational metrics
- [x] Graceful API, worker, and relay shutdown
- [x] Bounded upstream memory and timeouts
- [x] CI schema validation, audit, tests, and builds
- [x] Render checks-pass deployment and readiness gating
- [x] Scheduled production smoke verification
- [x] Critical regression tests added
- [ ] Vendor-backed traces/APM (deferred)
- [ ] Dedicated staging/canary fleet (deferred)
- [ ] Redis/job broker (threshold not reached)
