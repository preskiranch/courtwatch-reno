import { normalizeName } from "./normalization.js";

export interface TeamWatchIdentityInput {
  name: string;
  divisionName?: string | null;
  gradeLevel?: string | null;
}

export interface TeamWatchIdentity {
  displayName: string;
  normalizedName: string;
  ageLabel: string | null;
}

const AGE_RE = /\b(\d{1,2})\s*u\b/i;
const GRADE_RE = /\b(\d{1,2})(?:st|nd|rd|th)\b/gi;

/**
 * Builds the stable identity used to watch a team across tournaments.
 * Exposure sometimes stores only the program name on a team and keeps the
 * age in division metadata, so the age must be part of the watch key.
 */
export function teamWatchIdentity(
  input: TeamWatchIdentityInput,
): TeamWatchIdentity {
  const name = input.name.replace(/\s+/g, " ").trim();
  const normalizedTeamName = normalizeName(name);
  const explicitAge = ageFromText(normalizedTeamName);
  if (explicitAge !== null) {
    return {
      displayName: name,
      normalizedName: normalizedTeamName,
      ageLabel: `${explicitAge}U`,
    };
  }

  const metadata = [input.gradeLevel, input.divisionName].filter(
    (value): value is string => Boolean(value?.trim()),
  );
  const inferredAge =
    firstAge(metadata) ?? highestGradeAge([name, ...metadata]);
  if (inferredAge === null) {
    return {
      displayName: name,
      normalizedName: normalizedTeamName,
      ageLabel: null,
    };
  }

  const ageLabel = `${inferredAge}U`;
  const displayName = `${name} ${ageLabel}`;
  return {
    displayName,
    normalizedName: normalizeName(displayName),
    ageLabel,
  };
}

/**
 * Returns a broad database-search term while retaining the full query for
 * post-filtering. Example: "Splash City 10U" searches rows named
 * "Splash City", then canonical identity filtering selects only 10U.
 */
export function teamWatchSearchBase(value: string): string {
  const normalized = normalizeName(value);
  const withoutAge = normalized.replace(/\b\d{1,2}\s*u\b/g, " ");
  const collapsed = withoutAge.replace(/\s+/g, " ").trim();
  return collapsed.length >= 2 ? collapsed : normalized;
}

export function teamMatchesWatchIdentity(
  watchNormalizedName: string,
  team: TeamWatchIdentityInput & { normalizedName?: string | null },
): boolean {
  const normalizedWatch = normalizeName(watchNormalizedName);
  if (!normalizedWatch) return false;
  const canonical = teamWatchIdentity(team).normalizedName;
  const rawName = normalizeName(team.normalizedName ?? team.name);
  return normalizedWatch === canonical || normalizedWatch === rawName;
}

function firstAge(values: string[]): number | null {
  for (const value of values) {
    const age = ageFromText(value);
    if (age !== null) return age;
  }
  return null;
}

function ageFromText(value: string): number | null {
  const match = normalizeName(value).match(AGE_RE);
  const age = match?.[1] ? Number(match[1]) : Number.NaN;
  return Number.isInteger(age) && age >= 5 && age <= 20 ? age : null;
}

function highestGradeAge(values: string[]): number | null {
  const grades = values.flatMap((value) =>
    Array.from(normalizeName(value).matchAll(GRADE_RE), (match) =>
      Number(match[1]),
    ),
  );
  const validGrades = grades.filter(
    (grade) => Number.isInteger(grade) && grade >= 1 && grade <= 12,
  );
  return validGrades.length > 0 ? Math.max(...validGrades) + 6 : null;
}
