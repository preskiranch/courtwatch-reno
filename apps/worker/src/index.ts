import {
  calculatePollDelayMs,
  isAnyActiveTournamentWindow,
} from "@courtwatch/core";
import type { TournamentEvent } from "@courtwatch/core";
import pino from "pino";
import { z } from "zod";

const EnvSchema = z.object({
  API_BASE_URL: z.string().url().default("http://localhost:4000"),
  ADMIN_SECRET: z.string().optional(),
  NODE_ENV: z.string().default("development"),
  TOURNAMENT_DISCOVERY_INTERVAL_HOURS: z.coerce.number().default(24),
  WORKER_API_TIMEOUT_MS: z.coerce.number().default(300_000),
});

const env = EnvSchema.parse(process.env);
const logger = pino({ name: "courtwatch-reno-sync-worker" });
let failureCount = 0;
let shuttingDown = false;
let lastDiscoveryAt = 0;

process.on("SIGTERM", () => {
  shuttingDown = true;
  logger.info("received SIGTERM, stopping after current sync");
});

process.on("SIGINT", () => {
  shuttingDown = true;
  logger.info("received SIGINT, stopping after current sync");
});

async function syncOnce() {
  try {
    await discoverTournamentsIfDue();
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : error },
      "tournament discovery failed; continuing with normal sync",
    );
  }
  const response = await fetchWithTimeout(
    new URL("/api/admin/sync-now", env.API_BASE_URL),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.ADMIN_SECRET ? { "x-admin-secret": env.ADMIN_SECRET } : {}),
      },
      body: JSON.stringify({ source: "worker" }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `sync-now failed with ${response.status}: ${await response.text()}`,
    );
  }

  return response.json() as Promise<{
    status: string;
    teamsCount: number;
    gamesCount: number;
    changesDetected: number;
  }>;
}

async function discoverTournamentsIfDue() {
  const intervalMs = env.TOURNAMENT_DISCOVERY_INTERVAL_HOURS * 60 * 60 * 1000;
  if (Date.now() - lastDiscoveryAt < intervalMs) return;
  const response = await fetchWithTimeout(
    new URL("/api/admin/discover-tournaments", env.API_BASE_URL),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.ADMIN_SECRET ? { "x-admin-secret": env.ADMIN_SECRET } : {}),
      },
      body: JSON.stringify({ source: "worker" }),
    },
  );
  lastDiscoveryAt = Date.now();
  if (!response.ok) {
    throw new Error(
      `discover-tournaments failed with ${response.status}: ${await response.text()}`,
    );
  }
  logger.info(await response.json(), "tournament discovery completed");
}

async function loop() {
  while (!shuttingDown) {
    try {
      const result = await syncOnce();
      failureCount = 0;
      logger.info(result, "sync completed");
    } catch (error) {
      failureCount += 1;
      logger.error(
        { error: error instanceof Error ? error.message : error, failureCount },
        "sync failed",
      );
    }

    const delay = calculatePollDelayMs({
      failureCount,
      activeOverride: await activeTournamentOverride(),
    });
    logger.info({ delayMs: delay, failureCount }, "waiting for next sync");
    await sleep(delay);
  }
}

async function activeTournamentOverride(): Promise<boolean | undefined> {
  try {
    const response = await fetchWithTimeout(
      new URL("/api/events", env.API_BASE_URL),
    );
    if (!response.ok) return undefined;
    const events = (await response.json()) as TournamentEvent[];
    return isAnyActiveTournamentWindow(events);
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : error },
      "active tournament window check failed",
    );
    return undefined;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
) {
  if (init.signal || env.WORKER_API_TIMEOUT_MS <= 0) return fetch(input, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.WORKER_API_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

logger.info({ apiBaseUrl: env.API_BASE_URL }, "starting worker");
void loop();
