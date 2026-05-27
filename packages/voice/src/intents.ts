export type VoiceNavigationTarget =
  | "dashboard"
  | "schedule"
  | "teams"
  | "alerts"
  | "settings";

export type VoiceCommandIntent =
  | { type: "navigate"; target: VoiceNavigationTarget }
  | { type: "search"; query: string }
  | { type: "refresh" }
  | { type: "read-screen" }
  | { type: "stop-speaking" }
  | { type: "dictation"; text: string };

const NAVIGATION_KEYWORDS: Array<{
  target: VoiceNavigationTarget;
  words: string[];
}> = [
  { target: "dashboard", words: ["dashboard", "home", "main screen"] },
  { target: "schedule", words: ["schedule", "games", "calendar"] },
  { target: "teams", words: ["teams", "team list", "registered teams"] },
  { target: "alerts", words: ["alerts", "updates", "notifications"] },
  { target: "settings", words: ["settings", "preferences", "options"] },
];

export function parseVoiceCommand(transcript: string): VoiceCommandIntent {
  const text = transcript.trim();
  const normalized = normalizeCommandText(text);
  if (!normalized) return { type: "dictation", text };

  if (/\b(stop speaking|stop audio|quiet|cancel speech|mute)\b/.test(normalized))
    return { type: "stop-speaking" };

  if (/\b(refresh|reload|update|sync)\b/.test(normalized))
    return { type: "refresh" };

  if (/\b(read|speak|say|tell me)\b/.test(normalized))
    return { type: "read-screen" };

  const searchQuery = extractSearchQuery(normalized);
  if (searchQuery) return { type: "search", query: searchQuery };

  for (const item of NAVIGATION_KEYWORDS) {
    if (item.words.some((word) => normalized.includes(word))) {
      return { type: "navigate", target: item.target };
    }
  }

  return { type: "dictation", text };
}

function normalizeCommandText(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSearchQuery(normalized: string): string | null {
  const match = normalized.match(
    /(?:search|find|look up|show me|show|follow|choose|select)\s+(?:for\s+)?(?:team\s+|teams\s+|registered team\s+|registered teams\s+)?(.+)$/,
  );
  const query = match?.[1]?.trim();
  if (!query) return null;
  if (query.length < 2) return null;
  return query;
}
