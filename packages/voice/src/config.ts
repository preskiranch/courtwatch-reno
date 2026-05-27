import {
  DEFAULT_VOICE_LAYER_CONFIG,
  type DeepPartial,
  type VoiceLayerConfig,
} from "./types.js";

function clamp(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function stringOrFallback(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function normalizeVoiceLayerConfig(
  input: DeepPartial<VoiceLayerConfig> = {},
): VoiceLayerConfig {
  const language = stringOrFallback(
    input.language,
    DEFAULT_VOICE_LAYER_CONFIG.language,
  );
  const recognitionInput = input.recognition ?? {};
  const synthesisInput = input.synthesis ?? {};

  return {
    language,
    recognition: {
      lang: stringOrFallback(
        recognitionInput.lang,
        stringOrFallback(language, DEFAULT_VOICE_LAYER_CONFIG.recognition.lang),
      ),
      continuous:
        typeof recognitionInput.continuous === "boolean"
          ? recognitionInput.continuous
          : DEFAULT_VOICE_LAYER_CONFIG.recognition.continuous,
      interimResults:
        typeof recognitionInput.interimResults === "boolean"
          ? recognitionInput.interimResults
          : DEFAULT_VOICE_LAYER_CONFIG.recognition.interimResults,
      maxAlternatives: Math.round(
        clamp(
          recognitionInput.maxAlternatives,
          1,
          5,
          DEFAULT_VOICE_LAYER_CONFIG.recognition.maxAlternatives,
        ),
      ),
      timeoutMs: Math.round(
        clamp(
          recognitionInput.timeoutMs,
          3_000,
          60_000,
          DEFAULT_VOICE_LAYER_CONFIG.recognition.timeoutMs,
        ),
      ),
    },
    synthesis: {
      lang: stringOrFallback(
        synthesisInput.lang,
        stringOrFallback(language, DEFAULT_VOICE_LAYER_CONFIG.synthesis.lang),
      ),
      voiceURI:
        typeof synthesisInput.voiceURI === "string" &&
        synthesisInput.voiceURI.trim()
          ? synthesisInput.voiceURI.trim()
          : null,
      rate: clamp(
        synthesisInput.rate,
        0.5,
        2,
        DEFAULT_VOICE_LAYER_CONFIG.synthesis.rate,
      ),
      pitch: clamp(
        synthesisInput.pitch,
        0,
        2,
        DEFAULT_VOICE_LAYER_CONFIG.synthesis.pitch,
      ),
      volume: clamp(
        synthesisInput.volume,
        0,
        1,
        DEFAULT_VOICE_LAYER_CONFIG.synthesis.volume,
      ),
    },
    autoSpeakResponses:
      typeof input.autoSpeakResponses === "boolean"
        ? input.autoSpeakResponses
        : DEFAULT_VOICE_LAYER_CONFIG.autoSpeakResponses,
  };
}

export function sanitizeSpeakableText(text: string, maxLength = 1400): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  const truncated = normalized.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return `${truncated.slice(0, lastSpace > 200 ? lastSpace : maxLength)}.`;
}
