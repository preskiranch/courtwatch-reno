const PUNCTUATION_RE = /[^\p{L}\p{N}\s]/gu;
const SPACE_RE = /\s+/g;

const PROGRAM_SUFFIX_TOKENS = new Set([
  "basketball",
  "aau",
  "elite",
  "boys",
  "girls",
  "boy",
  "girl",
  "black",
  "white",
  "red",
  "blue",
  "green",
  "gold",
  "silver",
  "orange",
  "select",
  "academy",
  "club",
  "team",
  "grade",
  "grades",
  "level"
]);

const GRADE_OR_AGE_RE = /^(\d{1,2}(st|nd|rd|th)?|[1-9]\d?u)$/;

export function normalizeName(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(PUNCTUATION_RE, " ")
    .replace(SPACE_RE, " ")
    .trim();
}

export function compactName(name: string | null | undefined): string {
  return normalizeName(name).replace(/\s/g, "");
}

export function normalizeProgramName(name: string | null | undefined): string {
  const tokens = normalizeName(name)
    .split(" ")
    .filter(Boolean)
    .filter((token) => !PROGRAM_SUFFIX_TOKENS.has(token))
    .filter((token) => !GRADE_OR_AGE_RE.test(token));

  return tokens.join(" ").trim();
}

export function extractDivisionMeta(divisionName: string | null | undefined): {
  gender: string | null;
  gradeLevel: string | null;
  level: string | null;
} {
  const normalized = normalizeName(divisionName);
  const gender = normalized.includes("girls") ? "Girls" : normalized.includes("boys") ? "Boys" : null;
  const gradeMatch = normalized.match(/(\d{1,2}(st|nd|rd|th)|\d{1,2}u)/);
  const levelMatch = normalized.match(/level\s+\d+|gold|silver|bronze|green|blue|orange|black|white/);

  return {
    gender,
    gradeLevel: gradeMatch?.[1]?.toUpperCase() ?? null,
    level: levelMatch?.[0] ? titleCase(levelMatch[0]) : null
  };
}

export function titleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + substitutionCost
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j]!;
    }
  }

  return previous[b.length]!;
}

export function similarity(a: string, b: string): number {
  const left = compactName(a);
  const right = compactName(b);
  if (!left || !right) return 0;
  const distance = levenshtein(left, right);
  return 1 - distance / Math.max(left.length, right.length);
}
