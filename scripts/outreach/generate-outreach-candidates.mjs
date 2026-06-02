#!/usr/bin/env node

import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_API_BASE_URL = "https://courtwatch-reno-api.onrender.com";
const DEFAULT_WEB_BASE_URL = "https://courtwatchaau.com";

const args = parseArgs(process.argv.slice(2));
const apiBaseUrl = String(
  args.api ?? process.env.API_BASE_URL ?? DEFAULT_API_BASE_URL,
).replace(/\/$/, "");
const webBaseUrl = String(
  args.web ?? process.env.WEB_BASE_URL ?? DEFAULT_WEB_BASE_URL,
).replace(/\/$/, "");
const outputDir = path.resolve(String(args.output ?? "outreach/generated"));
const daysBack = Number(args.days ?? 21);
const maxTeams = Number(args["max-teams"] ?? 150);
const screenshotsEnabled = args.screenshots !== "false";
const selectedEvents = values(args.event)
  .map((value) => Number(value))
  .filter(Number.isFinite);

const recentCutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

await fs.mkdir(outputDir, { recursive: true });

const events = await apiGet("/api/events");
const explicitEventDetails =
  selectedEvents.length > 0
    ? await Promise.all(
        selectedEvents.map((eventId) => eventDetails(eventId, events)),
      )
    : [];
const eventPool =
  selectedEvents.length > 0
    ? dedupeEvents([...events, ...explicitEventDetails])
    : events;
const targetEvents = eventPool
  .filter((event) => {
    if (selectedEvents.length > 0)
      return selectedEvents.includes(event.exposureEventId);
    const eventEnd = new Date(`${event.endDate}T23:59:59`);
    return event.status === "completed" && eventEnd >= recentCutoff;
  })
  .sort((a, b) => String(b.endDate).localeCompare(String(a.endDate)));

if (targetEvents.length === 0) {
  console.log("No completed recent tournaments found for the current filters.");
  process.exit(0);
}

const candidates = [];
for (const event of targetEvents) {
  const [teams, results, leaders] = await Promise.all([
    apiGet(`/api/teams?exposureEventId=${event.exposureEventId}`),
    apiGet(`/api/results?scope=all&exposureEventId=${event.exposureEventId}`),
    apiGet(`/api/points-leaders?exposureEventId=${event.exposureEventId}`),
  ]);

  const resultByTeam = indexResults(results);
  const leaderByTeam = indexLeaders(leaders);
  for (const team of teams) {
    const key = teamKey(team);
    const result =
      resultByTeam.get(key) ??
      resultByTeam.get(fallbackTeamKey(team.name, team.divisionName));
    const leader =
      leaderByTeam.get(key) ??
      leaderByTeam.get(fallbackTeamKey(team.name, team.divisionName));
    const record = bestRecord(team.record, result?.record, leader);
    if (!hasUsefulAchievement(record, result, leader)) continue;

    candidates.push({
      event,
      team,
      result,
      leader,
      record,
      achievement: achievementText(team, result, leader, record),
      instagramSearchUrl: instagramSearchUrl(team, event),
      webSearchUrl: webSearchUrl(team, event),
    });
  }
}

candidates.sort(compareCandidates);
const selectedCandidates =
  maxTeams > 0 ? candidates.slice(0, maxTeams) : candidates;

let browser = null;
if (screenshotsEnabled && selectedCandidates.length > 0) {
  browser = await chromium.launch();
}

for (const candidate of selectedCandidates) {
  const slug = slugify(
    `${candidate.event.exposureEventId}-${candidate.team.name}-${candidate.team.divisionName ?? "division"}`,
  );
  const cardDir = path.join(outputDir, "cards");
  await fs.mkdir(cardDir, { recursive: true });
  candidate.cardOnePath = path.join(cardDir, `${slug}-achievement.png`);
  candidate.cardTwoPath = path.join(cardDir, `${slug}-parents.png`);

  if (browser) {
    await renderCard(
      browser,
      teamAchievementCard(candidate),
      candidate.cardOnePath,
    );
    await renderCard(
      browser,
      parentTrackerCard(candidate),
      candidate.cardTwoPath,
    );
  }

  candidate.messageDraft = messageDraft(candidate);
}

if (browser) await browser.close();

const csvPath = path.join(outputDir, "outreach-candidates.csv");
const jsonPath = path.join(outputDir, "outreach-candidates.json");
await fs.writeFile(csvPath, toCsv(selectedCandidates), "utf8");
await fs.writeFile(
  jsonPath,
  JSON.stringify(
    selectedCandidates.map((candidate) => ({
      event: candidate.event.name,
      exposureEventId: candidate.event.exposureEventId,
      team: candidate.team.name,
      division: candidate.team.divisionName,
      record: recordLabel(candidate.record),
      points:
        candidate.record?.totalPoints ?? candidate.leader?.totalPoints ?? null,
      placement: candidate.result
        ? `${candidate.result.placement} ${candidate.result.medalLabel}`
        : null,
      officialTeamPage: candidate.team.sourceUrl,
      source: candidate.result?.sourceUrl ?? candidate.event.officialUrl,
      instagramSearchUrl: candidate.instagramSearchUrl,
      webSearchUrl: candidate.webSearchUrl,
      cardOnePath: candidate.cardOnePath ?? null,
      cardTwoPath: candidate.cardTwoPath ?? null,
      messageDraft: candidate.messageDraft,
    })),
    null,
    2,
  ),
  "utf8",
);

console.log(
  `Prepared ${selectedCandidates.length} outreach candidates from ${targetEvents.length} tournaments.`,
);
console.log(`CSV: ${csvPath}`);
console.log(`JSON: ${jsonPath}`);
if (browser) console.log(`Cards: ${path.join(outputDir, "cards")}`);
console.log(
  "Manual approval required before sending any Instagram/TikTok message.",
);

function parseArgs(rawArgs) {
  const parsed = {};
  for (const arg of rawArgs) {
    if (!arg.startsWith("--")) continue;
    const [key, value = "true"] = arg.slice(2).split("=");
    if (parsed[key] === undefined) {
      parsed[key] = value;
    } else if (Array.isArray(parsed[key])) {
      parsed[key].push(value);
    } else {
      parsed[key] = [parsed[key], value];
    }
  }
  return parsed;
}

function values(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

async function apiGet(pathname) {
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
  });
  if (!response.ok) {
    throw new Error(
      `${pathname} failed with ${response.status}: ${await response.text()}`,
    );
  }
  return response.json();
}

async function eventDetails(exposureEventId, currentEvents) {
  const existing = currentEvents.find(
    (event) => event.exposureEventId === exposureEventId,
  );
  if (existing) return existing;
  return apiGet(`/api/events/current?exposureEventId=${exposureEventId}`);
}

function dedupeEvents(allEvents) {
  const byId = new Map();
  for (const event of allEvents) byId.set(event.exposureEventId, event);
  return [...byId.values()];
}

function indexResults(groups) {
  const index = new Map();
  for (const group of groups ?? []) {
    for (const row of group.rows ?? []) {
      const value = { ...row, divisionName: group.divisionName };
      if (row.teamId) index.set(`team:${row.teamId}`, value);
      index.set(
        fallbackTeamKey(row.teamNameSnapshot, group.divisionName),
        value,
      );
    }
  }
  return index;
}

function indexLeaders(leaders) {
  const index = new Map();
  for (const leader of leaders ?? []) {
    if (leader.teamId) index.set(`team:${leader.teamId}`, leader);
    index.set(fallbackTeamKey(leader.teamName, leader.divisionName), leader);
  }
  return index;
}

function teamKey(team) {
  return `team:${team.id}`;
}

function fallbackTeamKey(name, divisionName) {
  return `${normalize(name)}::${normalize(divisionName ?? "")}`;
}

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function bestRecord(...records) {
  const usable = records.filter(Boolean);
  if (usable.length === 0) return null;
  return usable.sort((a, b) => scoreRecord(b) - scoreRecord(a))[0];
}

function scoreRecord(record) {
  return (
    (Number(record.finalGames ?? 0) + Number(record.gamesScored ?? 0)) * 1000 +
    Number(record.wins ?? 0) * 10 +
    Number(record.losses ?? 0) +
    Number(record.totalPoints ?? 0) / 1000
  );
}

function hasUsefulAchievement(record, result, leader) {
  return Boolean(
    result ||
    (leader && Number(leader.totalPoints ?? 0) > 0) ||
    (record &&
      (Number(record.gamesScored ?? 0) > 0 ||
        Number(record.finalGames ?? 0) > 0)),
  );
}

function achievementText(team, result, leader, record) {
  const parts = [];
  if (result)
    parts.push(
      `${placementLabel(result.placement)} place / ${result.medalLabel}`,
    );
  if (record) parts.push(`${recordLabel(record)} record`);
  if (leader?.totalPoints) parts.push(`${leader.totalPoints} total points`);
  return parts.length > 0
    ? parts.join(" | ")
    : `${team.divisionName ?? "Tournament"} team`;
}

function placementLabel(placement) {
  if (placement === 1) return "1st";
  if (placement === 2) return "2nd";
  if (placement === 3) return "3rd";
  return `${placement}`;
}

function recordLabel(record) {
  if (!record) return "Record pending";
  const ties = Number(record.ties ?? 0);
  return ties > 0
    ? `${record.wins}-${record.losses}-${ties}`
    : `${record.wins}-${record.losses}`;
}

function instagramSearchUrl(team, event) {
  const query = `${team.name} ${team.divisionName ?? ""} basketball instagram`;
  return `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(query)}`;
}

function webSearchUrl(team, event) {
  const query = `${team.name} ${event.name} basketball Instagram`;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function compareCandidates(a, b) {
  const placementA = a.result?.placement ?? 99;
  const placementB = b.result?.placement ?? 99;
  if (placementA !== placementB) return placementA - placementB;
  const pointsA = Number(a.record?.totalPoints ?? a.leader?.totalPoints ?? 0);
  const pointsB = Number(b.record?.totalPoints ?? b.leader?.totalPoints ?? 0);
  if (pointsA !== pointsB) return pointsB - pointsA;
  return `${a.event.name} ${a.team.name}`.localeCompare(
    `${b.event.name} ${b.team.name}`,
  );
}

function messageDraft(candidate) {
  return `Hello ${candidate.team.name},\n\nCongratulations on ${candidate.achievement} at ${candidate.event.name}. We built Court Watch AAU to make tournament weekends easier for parents and coaches, especially when families are tracking multiple teams at once.\n\nYour team is already listed with schedules, records, brackets, points, and final placements. If you are open to it, please give the free site a try and send any feedback you are willing to share.\n\n${webBaseUrl}`;
}

async function renderCard(browser, html, outputPath) {
  const page = await browser.newPage({
    viewport: { width: 1080, height: 1080 },
    deviceScaleFactor: 1,
  });
  await page.setContent(html, { waitUntil: "networkidle" });
  const card = page.locator("[data-card]").first();
  await card.screenshot({ path: outputPath });
  await page.close();
}

function teamAchievementCard(candidate) {
  const placement = candidate.result
    ? `${placementLabel(candidate.result.placement)} / ${candidate.result.medalLabel}`
    : "Team achievement";
  return cardHtml({
    eyebrow: candidate.event.organizer ?? "Court Watch AAU",
    title: candidate.team.name,
    subtitle: candidate.team.divisionName ?? candidate.event.name,
    statOne: placement,
    statTwo: `${recordLabel(candidate.record)} W-L`,
    statThree: `${candidate.record?.totalPoints ?? candidate.leader?.totalPoints ?? 0} points`,
    footer: candidate.event.name,
  });
}

function parentTrackerCard(candidate) {
  return cardHtml({
    eyebrow: "Free parent tournament tracker",
    title: "Court Watch AAU",
    subtitle: "Schedules, records, brackets, alerts, and final placements.",
    statOne: candidate.team.name,
    statTwo: candidate.team.divisionName ?? "Tournament team",
    statThree: webBaseUrl.replace("https://", ""),
    footer: "Built for families following multiple AAU teams.",
  });
}

function cardHtml(input) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #07111f;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    [data-card] {
      width: 960px;
      min-height: 960px;
      padding: 64px;
      border-radius: 34px;
      color: #ffffff;
      background:
        linear-gradient(135deg, rgba(255,106,0,.22), transparent 42%),
        radial-gradient(circle at top right, rgba(91,213,177,.25), transparent 34%),
        #0b1728;
      border: 2px solid rgba(255,255,255,.16);
      box-shadow: 0 30px 90px rgba(0,0,0,.45);
    }
    .eyebrow {
      color: #ffb36b;
      font-size: 28px;
      font-weight: 900;
      letter-spacing: 6px;
      text-transform: uppercase;
    }
    h1 {
      margin: 42px 0 18px;
      font-size: 82px;
      line-height: 1.02;
      letter-spacing: 0;
    }
    .subtitle {
      color: #d9e4f2;
      font-size: 38px;
      line-height: 1.25;
      font-weight: 800;
    }
    .stats {
      display: grid;
      gap: 20px;
      margin: 58px 0;
    }
    .stat {
      display: flex;
      align-items: center;
      min-height: 112px;
      padding: 22px 28px;
      border-radius: 22px;
      background: rgba(255,255,255,.96);
      color: #070a17;
      font-size: 34px;
      font-weight: 950;
    }
    .ball {
      display: inline-grid;
      place-items: center;
      width: 72px;
      height: 72px;
      margin-right: 22px;
      border-radius: 20px;
      background: #ff5f05;
      color: #fff;
      font-size: 38px;
    }
    .footer {
      margin-top: 44px;
      padding-top: 34px;
      border-top: 2px solid rgba(255,255,255,.16);
      color: #d9e4f2;
      font-size: 30px;
      font-weight: 800;
    }
  </style>
</head>
<body>
  <main data-card>
    <div class="eyebrow">${escapeHtml(input.eyebrow)}</div>
    <h1>${escapeHtml(input.title)}</h1>
    <div class="subtitle">${escapeHtml(input.subtitle)}</div>
    <div class="stats">
      <div class="stat"><span class="ball">1</span>${escapeHtml(input.statOne)}</div>
      <div class="stat"><span class="ball">W</span>${escapeHtml(input.statTwo)}</div>
      <div class="stat"><span class="ball">P</span>${escapeHtml(input.statThree)}</div>
    </div>
    <div class="footer">${escapeHtml(input.footer)}</div>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function slugify(value) {
  return normalize(value).replaceAll(" ", "-").slice(0, 120);
}

function toCsv(candidates) {
  const header = [
    "event",
    "exposure_event_id",
    "team",
    "division",
    "record",
    "points",
    "placement",
    "official_team_page",
    "source",
    "instagram_search_url",
    "web_search_url",
    "card_achievement",
    "card_parents",
    "message_draft",
  ];
  const rows = candidates.map((candidate) => [
    candidate.event.name,
    candidate.event.exposureEventId,
    candidate.team.name,
    candidate.team.divisionName ?? "",
    recordLabel(candidate.record),
    candidate.record?.totalPoints ?? candidate.leader?.totalPoints ?? "",
    candidate.result
      ? `${placementLabel(candidate.result.placement)} / ${candidate.result.medalLabel}`
      : "",
    candidate.team.sourceUrl ?? "",
    candidate.result?.sourceUrl ?? candidate.event.officialUrl,
    candidate.instagramSearchUrl,
    candidate.webSearchUrl,
    candidate.cardOnePath ?? "",
    candidate.cardTwoPath ?? "",
    candidate.messageDraft,
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}
