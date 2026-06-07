import { californiaTournamentRegionFromPlace } from "./california-region.js";
import type { TournamentEvent } from "./types.js";

export type CourtWatchSupportedTournamentRegion =
  | "Northern California"
  | "Southern California"
  | "Nevada";

export const COURTWATCH_SUPPORTED_TOURNAMENT_REGIONS: CourtWatchSupportedTournamentRegion[] =
  ["Northern California", "Southern California", "Nevada"];

type TournamentRegionInput = Pick<
  TournamentEvent,
  "city" | "state" | "location" | "region"
>;

export function courtWatchSupportedTournamentRegion(
  event: TournamentRegionInput,
): CourtWatchSupportedTournamentRegion | null {
  const state = tournamentStateCode(event);
  if (state === "NV") return "Nevada";
  if (state !== "CA") return null;

  return californiaTournamentRegionFromPlace(
    `${event.city ?? ""} ${event.location ?? ""} ${event.region ?? ""}`,
  );
}

export function isCourtWatchSupportedTournamentRegion(
  event: TournamentRegionInput,
): boolean {
  return courtWatchSupportedTournamentRegion(event) !== null;
}

export function tournamentStateCode(
  event: TournamentRegionInput,
): string | null {
  const source =
    `${event.state ?? ""} ${event.city ?? ""} ${event.location ?? ""}`.toLowerCase();
  if (/\bca\b|\bcalifornia\b/.test(source)) return "CA";
  if (/\bnv\b|\bnevada\b/.test(source)) return "NV";
  const state = event.state?.trim().toUpperCase();
  return state || null;
}
