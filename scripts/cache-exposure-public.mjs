#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PublicExposurePageClient } from "../packages/core/dist/public-exposure-page-client.js";

const apiEventsUrl =
  process.env.PUBLIC_EXPOSURE_CACHE_EVENTS_URL ??
  "https://courtwatch-reno-api.onrender.com/api/events";
const outputDir = path.resolve(
  process.argv[2] ??
    process.env.PUBLIC_EXPOSURE_CACHE_OUTPUT_DIR ??
    "exposure-cache/events",
);
const windowDays = positiveInteger(
  process.env.PUBLIC_EXPOSURE_CACHE_WINDOW_DAYS,
  30,
);
const maxEvents = positiveInteger(
  process.env.PUBLIC_EXPOSURE_CACHE_MAX_EVENTS,
  30,
);
const requestDelayMs = positiveInteger(
  process.env.PUBLIC_EXPOSURE_CACHE_REQUEST_DELAY_MS,
  1000,
);
const allowedEventIds = new Set(
  (process.env.PUBLIC_EXPOSURE_CACHE_EVENT_IDS ?? "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isSafeInteger(value) && value > 0),
);

await mkdir(outputDir, { recursive: true });

const events = await fetchEvents();
const selectedEvents = events
  .filter(isEligibleEvent)
  .sort((left, right) =>
    left.startDate === right.startDate
      ? left.name.localeCompare(right.name)
      : left.startDate.localeCompare(right.startDate),
  )
  .slice(0, maxEvents);

const client = new PublicExposurePageClient();
let written = 0;

for (const event of selectedEvents) {
  try {
    const teams = await client.fetchTeams(
      event.exposureEventId,
      event.slug,
      event.timezone,
    );
    const teamIds = teams.teams
      .map((team) => team.exposureTeamId)
      .filter((value) => typeof value === "string" && value.length > 0);
    const games = await client.fetchGames(event.exposureEventId, {
      eventSlug: event.slug,
      teamIds,
      timezone: event.timezone,
    });
    if (teams.teams.length === 0 && games.length === 0) {
      console.warn(
        JSON.stringify({
          eventId: event.exposureEventId,
          message: "No public teams or games found; cache not updated",
          name: event.name,
        }),
      );
      continue;
    }

    const payload = {
      schemaVersion: 1,
      cachedAt: new Date().toISOString(),
      eventId: event.exposureEventId,
      eventSlug: event.slug,
      event: {
        endDate: event.endDate,
        name: event.name,
        officialUrl: event.officialUrl,
        organizer: event.organizer,
        startDate: event.startDate,
        timezone: event.timezone,
      },
      divisions: teams.divisions,
      teams: teams.teams,
      games,
    };
    await writeFile(
      path.join(outputDir, `${event.exposureEventId}.json`),
      `${JSON.stringify(payload, null, 2)}\n`,
    );
    written += 1;
    console.log(
      JSON.stringify({
        divisions: teams.divisions.length,
        eventId: event.exposureEventId,
        games: games.length,
        name: event.name,
        teams: teams.teams.length,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        eventId: event.exposureEventId,
        message: "Exposure cache refresh failed",
        name: event.name,
      }),
    );
  }

  if (requestDelayMs > 0) await sleep(requestDelayMs);
}

console.log(
  JSON.stringify({
    checked: selectedEvents.length,
    outputDir,
    written,
  }),
);

if (selectedEvents.length > 0 && written === 0) process.exitCode = 1;

async function fetchEvents() {
  const response = await fetch(apiEventsUrl, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Event catalog request failed with ${response.status}`);
  }
  const body = await response.json();
  if (!Array.isArray(body)) throw new Error("Event catalog is not an array");
  return body.filter(isExposureEvent);
}

function isExposureEvent(value) {
  return (
    value &&
    typeof value === "object" &&
    value.externalProvider === "exposure_events" &&
    Number.isSafeInteger(value.exposureEventId) &&
    typeof value.slug === "string" &&
    typeof value.name === "string" &&
    typeof value.startDate === "string" &&
    typeof value.endDate === "string" &&
    typeof value.timezone === "string"
  );
}

function isEligibleEvent(event) {
  if (allowedEventIds.size && !allowedEventIds.has(event.exposureEventId)) {
    return false;
  }
  if (!["active", "upcoming"].includes(event.status)) return false;
  if (!event.hasPublicTeamList || event.registeredTeamCount <= 0) return false;

  const todayKey = dateKeyInPacific(new Date());
  return (
    event.endDate >= todayKey &&
    event.startDate <= addDaysKey(todayKey, windowDays)
  );
}

function dateKeyInPacific(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Los_Angeles",
    year: "numeric",
  }).formatToParts(date);
  const lookup = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function addDaysKey(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
