import * as cheerio from "cheerio";
import { extractDivisionMeta, normalizeName } from "./normalization.js";
import type { Division, Team } from "./types.js";

export interface PublicExposureTeamResult {
  divisions: Division[];
  teams: Team[];
}

export interface PublicExposurePageClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class PublicExposurePageClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PublicExposurePageClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? process.env.EXPOSURE_PUBLIC_BASE_URL ?? "https://basketball.exposureevents.com";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetchTeams(eventId: number, eventSlug = "2026-reno-memorial-day-tournament"): Promise<PublicExposureTeamResult> {
    const url = `${this.baseUrl}/${eventId}/${eventSlug}/teams`;
    const response = await this.fetchImpl(url, {
      headers: {
        "User-Agent": "CourtWatchReno/0.1 (+independent companion tracker; respectful cache-backed polling)"
      }
    });
    if (!response.ok) {
      throw new Error(`Public teams page request failed with ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const divisions = new Map<string, Division>();
    const teams: Team[] = [];
    let currentDivisionName = "Unknown Division";

    $("#content h2, #content a[href*='/teams/']").each((_, element) => {
      const node = $(element);
      if (element.tagName.toLowerCase() === "h2") {
        currentDivisionName = node.text().replace(/\s+/g, " ").trim();
        return;
      }

      const href = node.attr("href") ?? "";
      const name = node.text().replace(/\s+/g, " ").trim();
      if (!name || !href.includes("/teams/")) return;

      const divisionTeamId = new URL(href, this.baseUrl).searchParams.get("divisionteamid");
      const divisionKey = normalizeName(currentDivisionName) || "unknown";
      const divisionId = `public-division-${divisionKey.replace(/\s/g, "-")}`;
      const meta = extractDivisionMeta(currentDivisionName);
      divisions.set(divisionId, {
        id: divisionId,
        eventId: `event-${eventId}`,
        exposureDivisionId: divisionKey,
        name: currentDivisionName,
        gender: meta.gender,
        gradeLevel: meta.gradeLevel,
        level: meta.level,
        rawJson: { source: "public_page" }
      });

      teams.push({
        id: `public-team-${divisionTeamId ?? normalizeName(`${currentDivisionName}-${name}`).replace(/\s/g, "-")}`,
        eventId: `event-${eventId}`,
        divisionId,
        exposureTeamId: divisionTeamId,
        name,
        normalizedName: normalizeName(name),
        clubName: null,
        normalizedClubName: null,
        coachName: null,
        sourceUrl: new URL(href, this.baseUrl).toString(),
        divisionName: currentDivisionName,
        gender: meta.gender,
        gradeLevel: meta.gradeLevel,
        level: meta.level,
        rawJson: { source: "public_page", href },
        lastSeenAt: new Date().toISOString()
      });
    });

    return { divisions: Array.from(divisions.values()), teams };
  }
}
