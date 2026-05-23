import { createHmac } from "node:crypto";
import { z } from "zod";

const ExposureTeamSchema = z.object({
  Id: z.union([z.number(), z.string()]),
  Name: z.string(),
  Division: z
    .object({
      Id: z.union([z.number(), z.string()]).optional(),
      Name: z.string().optional()
    })
    .optional()
}).passthrough();

const ExposureGameSchema = z.object({
  Id: z.union([z.number(), z.string()]),
  Date: z.string().optional(),
  Time: z.string().optional(),
  Type: z.union([z.number(), z.string()]).optional(),
  BracketName: z.string().optional(),
  Division: z
    .object({
      Id: z.union([z.number(), z.string()]).optional(),
      Name: z.string().optional()
    })
    .optional(),
  VenueCourt: z.unknown().optional(),
  HomeTeam: z.unknown().optional(),
  AwayTeam: z.unknown().optional()
}).passthrough();

const ExposurePlayerSchema = z.object({
  Id: z.union([z.number(), z.string()]),
  FirstName: z.string().optional(),
  LastName: z.string().optional(),
  Name: z.string().optional(),
  Teams: z
    .array(
      z
        .object({
          Id: z.union([z.number(), z.string()]).optional(),
          Name: z.string().optional()
        })
        .passthrough()
    )
    .optional()
}).passthrough();

export type ExposureTeam = z.infer<typeof ExposureTeamSchema>;
export type ExposureGame = z.infer<typeof ExposureGameSchema>;
export type ExposurePlayer = z.infer<typeof ExposurePlayerSchema>;

export interface ExposureClientOptions {
  apiKey?: string | null;
  secretKey?: string | null;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class ExposureClient {
  private readonly apiKey: string | null;
  private readonly secretKey: string | null;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ExposureClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.EXPOSURE_API_KEY ?? null;
    this.secretKey = options.secretKey ?? process.env.EXPOSURE_SECRET_KEY ?? null;
    this.baseUrl = options.baseUrl ?? process.env.EXPOSURE_PUBLIC_BASE_URL ?? "https://basketball.exposureevents.com";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get configured(): boolean {
    return Boolean(this.apiKey && this.secretKey);
  }

  async fetchTeams(eventId: number): Promise<ExposureTeam[]> {
    if (!this.configured) return [];
    const payload = await this.fetchPaged("/api/v1/teams", { eventid: String(eventId), pagesize: "250" }, "Teams");
    return payload.map((item) => ExposureTeamSchema.parse(item));
  }

  async fetchGames(eventId: number): Promise<ExposureGame[]> {
    if (!this.configured) return [];
    const payload = await this.fetchPaged("/api/v1/games", { eventid: String(eventId), pagesize: "250" }, "Games");
    return payload.map((item) => ExposureGameSchema.parse(item));
  }

  async fetchPlayers(eventId: number): Promise<ExposurePlayer[]> {
    if (!this.configured) return [];
    const payload = await this.fetchPaged("/api/v1/players", { eventid: String(eventId), pagesize: "250" }, "Players");
    return payload.map((item) => ExposurePlayerSchema.parse(item));
  }

  private async fetchPaged(path: string, params: Record<string, string>, rootKey: "Teams" | "Games" | "Players"): Promise<unknown[]> {
    const results: unknown[] = [];
    let page = 1;
    let total = Number.POSITIVE_INFINITY;
    const pageSize = Number(params.pagesize ?? 250);

    while (results.length < total) {
      const payload = await this.fetchJson(path, { ...params, page: String(page) });
      const root = payload[rootKey] as { Results?: unknown[]; Total?: number } | undefined;
      const pageResults = root?.Results ?? [];
      results.push(...pageResults);
      total = Number(root?.Total ?? pageResults.length);
      if (pageResults.length < pageSize || page > 50) break;
      page += 1;
    }

    return results;
  }

  private async fetchJson(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    if (!this.apiKey || !this.secretKey) {
      throw new Error("Exposure API credentials are not configured.");
    }

    const timestamp = new Date().toISOString();
    const signature = this.sign("GET", timestamp, path);
    const url = new URL(path, this.baseUrl);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Timestamp: timestamp,
        Authentication: `${this.apiKey}.${signature}`
      }
    });

    if (!response.ok) {
      throw new Error(`Exposure API request failed with ${response.status}`);
    }

    return (await response.json()) as Record<string, unknown>;
  }

  sign(verb: string, timestamp: string, relativeUri: string): string {
    if (!this.apiKey || !this.secretKey) {
      throw new Error("Exposure API credentials are not configured.");
    }
    const message = `${this.apiKey}&${verb}&${timestamp}&${relativeUri}`.toUpperCase();
    return createHmac("sha256", this.secretKey).update(message).digest("base64");
  }
}
