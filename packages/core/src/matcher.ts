import type { MatchType, ProgramAlias, ProgramWatchlist, Team } from "./types.js";
import { compactName, normalizeName, normalizeProgramName, similarity } from "./normalization.js";

export interface ProgramMatchResult {
  matched: boolean;
  matchType: MatchType | null;
  confidence: number;
  matchedAlias: string | null;
  reason: string;
}

const BLOCKED_CONTEXT_TOKENS = new Set(["tech", "high", "school", "college", "university", "soccer", "fc"]);

function hasBlockedContext(candidate: string): boolean {
  const tokens = normalizeName(candidate).split(" ");
  return tokens.some((token) => BLOCKED_CONTEXT_TOKENS.has(token));
}

function candidateNames(team: Pick<Team, "name" | "clubName" | "normalizedName" | "normalizedClubName">): string[] {
  return [team.name, team.clubName, team.normalizedName, team.normalizedClubName]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim())
    .filter(Boolean);
}

export function matchTeamToProgram(
  team: Pick<Team, "name" | "clubName" | "normalizedName" | "normalizedClubName">,
  program: Pick<ProgramWatchlist, "programName" | "normalizedProgramName">,
  aliases: Array<Pick<ProgramAlias, "alias" | "normalizedAlias">>
): ProgramMatchResult {
  const rawAliases = [program.programName, program.normalizedProgramName, ...aliases.map((alias) => alias.alias), ...aliases.map((alias) => alias.normalizedAlias)]
    .filter(Boolean)
    .map((alias) => alias.trim());
  const normalizedAliases = Array.from(new Set(rawAliases.map(normalizeName).filter(Boolean)));
  const programAliases = Array.from(new Set(rawAliases.map(normalizeProgramName).filter(Boolean)));
  const compactAliases = Array.from(new Set([...normalizedAliases, ...programAliases].map(compactName).filter(Boolean)));

  for (const candidate of candidateNames(team)) {
    const normalized = normalizeName(candidate);
    if (hasBlockedContext(candidate)) {
      continue;
    }

    if (normalizedAliases.includes(normalized)) {
      return { matched: true, matchType: "exact", confidence: 1, matchedAlias: normalized, reason: "Exact normalized name match" };
    }

    const normalizedProgram = normalizeProgramName(candidate);
    if (programAliases.includes(normalizedProgram)) {
      return { matched: true, matchType: "normalized", confidence: 0.96, matchedAlias: normalizedProgram, reason: "Program-normalized name match" };
    }

    for (const alias of programAliases) {
      const phraseMatch =
        normalizedProgram === alias ||
        normalizedProgram.startsWith(`${alias} `) ||
        normalizedProgram.endsWith(` ${alias}`) ||
        normalizedProgram.includes(` ${alias} `);
      if (phraseMatch) {
        return { matched: true, matchType: "alias", confidence: 0.92, matchedAlias: alias, reason: "Alias tokens present after suffix removal" };
      }
    }

    const compactCandidate = compactName(normalizedProgram);
    if (compactAliases.includes(compactCandidate)) {
      return { matched: true, matchType: "normalized", confidence: 0.94, matchedAlias: compactCandidate, reason: "Compact normalized name match" };
    }

    for (const alias of compactAliases) {
      if (alias.length < 6 || compactCandidate.length < 6) continue;
      const score = similarity(compactCandidate, alias);
      const containsAlias = compactCandidate.startsWith(alias) || compactCandidate.endsWith(alias);
      if (score >= 0.86 || (containsAlias && Math.abs(compactCandidate.length - alias.length) <= 8)) {
        return { matched: true, matchType: "fuzzy", confidence: Number(score.toFixed(2)), matchedAlias: alias, reason: "Fuzzy alias match" };
      }
    }
  }

  return { matched: false, matchType: null, confidence: 0, matchedAlias: null, reason: "No safe program match" };
}

export function findProgramMatches(
  teams: Team[],
  programs: ProgramWatchlist[],
  aliases: ProgramAlias[]
): Array<{ team: Team; program: ProgramWatchlist; result: ProgramMatchResult }> {
  return teams.flatMap((team) =>
    programs
      .filter((program) => program.active)
      .map((program) => ({
        team,
        program,
        result: matchTeamToProgram(
          team,
          program,
          aliases.filter((alias) => alias.programWatchlistId === program.id)
        )
      }))
      .filter((entry) => entry.result.matched)
  );
}
