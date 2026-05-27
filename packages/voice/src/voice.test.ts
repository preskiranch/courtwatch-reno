import { describe, expect, it } from "vitest";
import {
  DEFAULT_VOICE_LAYER_CONFIG,
  normalizeVoiceLayerConfig,
  parseVoiceCommand,
  sanitizeSpeakableText,
} from "./index.js";

describe("voice layer config", () => {
  it("normalizes language and clamps synthesis values", () => {
    const config = normalizeVoiceLayerConfig({
      language: "es-US",
      recognition: { timeoutMs: 100, maxAlternatives: 99 },
      synthesis: { rate: 7, pitch: -1, volume: 2 },
    });

    expect(config.language).toBe("es-US");
    expect(config.recognition.lang).toBe("es-US");
    expect(config.recognition.timeoutMs).toBe(3000);
    expect(config.recognition.maxAlternatives).toBe(5);
    expect(config.synthesis.lang).toBe("es-US");
    expect(config.synthesis.rate).toBe(2);
    expect(config.synthesis.pitch).toBe(0);
    expect(config.synthesis.volume).toBe(1);
  });

  it("falls back to defaults for empty input", () => {
    expect(normalizeVoiceLayerConfig()).toEqual(DEFAULT_VOICE_LAYER_CONFIG);
  });

  it("sanitizes text before speaking", () => {
    expect(sanitizeSpeakableText("  One\n\n two\tthree  ")).toBe(
      "One two three",
    );
  });
});

describe("voice command parser", () => {
  it("routes navigation commands", () => {
    expect(parseVoiceCommand("open the schedule")).toEqual({
      type: "navigate",
      target: "schedule",
    });
  });

  it("extracts registered team searches", () => {
    expect(parseVoiceCommand("search team Splash City 12U")).toEqual({
      type: "search",
      query: "splash city 12u",
    });
  });

  it("routes utility commands", () => {
    expect(parseVoiceCommand("refresh this page")).toEqual({
      type: "refresh",
    });
    expect(parseVoiceCommand("read this screen")).toEqual({
      type: "read-screen",
    });
    expect(parseVoiceCommand("stop speaking")).toEqual({
      type: "stop-speaking",
    });
  });

  it("keeps general speech as dictation", () => {
    expect(parseVoiceCommand("PMA Knights")).toEqual({
      type: "dictation",
      text: "PMA Knights",
    });
  });
});
