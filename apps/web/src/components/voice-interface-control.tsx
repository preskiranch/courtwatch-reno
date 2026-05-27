"use client";

import {
  DEFAULT_VOICE_LANGUAGE_OPTIONS,
  createBrowserVoiceLayer,
  normalizeVoiceLayerConfig,
  parseVoiceCommand,
  sanitizeSpeakableText,
  type VoiceCommandIntent,
  type VoiceLayerConfig,
  type VoiceLayerSupport,
  type VoiceSynthesisVoice,
} from "@courtwatch/voice";
import clsx from "clsx";
import {
  Languages,
  Mic,
  MicOff,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const VOICE_CONFIG_STORAGE_KEY = "courtwatch:voice-config:v1";

type VoiceInterfaceControlProps = {
  activeTab: string;
  readableText: string;
  onCommand: (intent: VoiceCommandIntent) => void;
};

export function VoiceInterfaceControl({
  activeTab,
  readableText,
  onCommand,
}: VoiceInterfaceControlProps) {
  const layerRef = useRef<ReturnType<typeof createBrowserVoiceLayer> | null>(
    null,
  );
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [voices, setVoices] = useState<VoiceSynthesisVoice[]>([]);
  const [support, setSupport] = useState<VoiceLayerSupport>({
    recognition: false,
    synthesis: false,
    voices: false,
  });
  const [config, setConfig] = useState<VoiceLayerConfig>(() =>
    loadStoredVoiceConfig(),
  );

  useEffect(() => {
    const layer = createBrowserVoiceLayer();
    layerRef.current = layer;
    const refreshSupport = () => {
      const nextVoices = layer.getVoices();
      setVoices(nextVoices);
      setSupport({ ...layer.getSupport(), voices: nextVoices.length > 0 });
    };
    refreshSupport();
    window.speechSynthesis?.addEventListener("voiceschanged", refreshSupport);
    return () => {
      window.speechSynthesis?.removeEventListener(
        "voiceschanged",
        refreshSupport,
      );
      layer.cancelSpeaking();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      VOICE_CONFIG_STORAGE_KEY,
      JSON.stringify(config),
    );
  }, [config]);

  const speakText = useCallback(
    async (text: string) => {
      const layer = layerRef.current;
      if (!layer || !support.synthesis) return;
      setSpeaking(true);
      setError(null);
      try {
        await layer.speak(text, config);
      } catch (speechError) {
        setError(errorMessage(speechError));
      } finally {
        setSpeaking(false);
      }
    },
    [config, support.synthesis],
  );

  const stopSpeaking = useCallback(() => {
    layerRef.current?.cancelSpeaking();
    setSpeaking(false);
  }, []);

  const readScreen = useCallback(() => {
    const text =
      sanitizeSpeakableText(readableText || readableDomText()) ||
      `Court Watch AAU ${activeTab} screen is ready.`;
    void speakText(text);
  }, [activeTab, readableText, speakText]);

  const startListening = useCallback(async () => {
    const layer = layerRef.current;
    if (!layer || listening) return;
    setOpen(true);
    setListening(true);
    setTranscript("");
    setError(null);
    try {
      const result = await layer.listenOnce(config, {
        onInterimResult: (interim) => setTranscript(interim.transcript),
      });
      setTranscript(result.transcript);
      const intent = parseVoiceCommand(result.transcript);
      if (intent.type === "read-screen") {
        readScreen();
      } else if (intent.type === "stop-speaking") {
        stopSpeaking();
      } else {
        onCommand(intent);
        if (config.autoSpeakResponses) {
          void speakText(confirmationForIntent(intent));
        }
      }
    } catch (listenError) {
      setError(errorMessage(listenError));
    } finally {
      setListening(false);
    }
  }, [
    config,
    listening,
    onCommand,
    readScreen,
    speakText,
    stopSpeaking,
  ]);

  const updateConfig = (next: Partial<VoiceLayerConfig>) => {
    setConfig((current) => normalizeVoiceLayerConfig({ ...current, ...next }));
  };

  const updateLanguage = (language: string) => {
    setConfig((current) =>
      normalizeVoiceLayerConfig({
        ...current,
        language,
        recognition: { ...current.recognition, lang: language },
        synthesis: { ...current.synthesis, lang: language },
      }),
    );
  };

  const updateVoice = (voiceURI: string) => {
    setConfig((current) =>
      normalizeVoiceLayerConfig({
        ...current,
        synthesis: {
          ...current.synthesis,
          voiceURI: voiceURI || null,
        },
      }),
    );
  };

  const canListen = support.recognition && !listening;
  const compactLabel = listening ? "Listening" : speaking ? "Speaking" : "Voice";

  return (
    <div className="fixed bottom-[5.75rem] right-3 z-40 flex w-[calc(100%-1.5rem)] max-w-[360px] justify-end sm:bottom-6 sm:right-5">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/15 bg-[#07111f]/95 px-3 text-sm font-black text-white shadow-2xl backdrop-blur active:scale-[0.98]"
          aria-label="Open voice controls"
          data-testid="voice-open-button"
        >
          {listening ? (
            <MicOff className="h-4 w-4 text-orange-300" />
          ) : (
            <Mic className="h-4 w-4 text-emerald-300" />
          )}
          {compactLabel}
        </button>
      ) : (
        <section
          className="w-full rounded-lg border border-white/15 bg-[#07111f]/95 p-3 text-white shadow-2xl backdrop-blur"
          data-testid="voice-control-panel"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-orange-300">
                Voice Interface
              </p>
              <h2 className="text-base font-black">Talk to Court Watch</h2>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 text-slate-100 active:scale-95"
              aria-label="Close voice controls"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={startListening}
              disabled={!canListen}
              className={clsx(
                "flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-black active:scale-[0.98]",
                canListen
                  ? "bg-orange-500 text-white"
                  : "bg-white/10 text-slate-400",
              )}
            >
              {listening ? (
                <MicOff className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
              {listening ? "Listening" : "Speak"}
            </button>
            <button
              type="button"
              onClick={readScreen}
              disabled={!support.synthesis}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-white/10 px-2 text-xs font-black text-slate-100 active:scale-[0.98] disabled:text-slate-500"
            >
              <Volume2 className="h-4 w-4" />
              Read
            </button>
            <button
              type="button"
              onClick={stopSpeaking}
              disabled={!speaking}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-white/10 px-2 text-xs font-black text-slate-100 active:scale-[0.98] disabled:text-slate-500"
            >
              <VolumeX className="h-4 w-4" />
              Stop
            </button>
          </div>

          <p className="mt-3 rounded-lg bg-white/8 p-2 text-xs font-semibold text-slate-200">
            {transcript ||
              "Try: “open schedule”, “search Splash City 12U”, “refresh”, or “read screen”."}
          </p>
          {error ? (
            <p className="mt-2 rounded-lg bg-amber-100 px-2 py-1.5 text-xs font-black text-amber-800">
              {error}
            </p>
          ) : null}
          {!support.recognition ? (
            <p className="mt-2 text-[11px] font-semibold text-slate-400">
              Speech input is not available in this browser. Read-aloud can
              still work when speech synthesis is supported.
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => setSettingsOpen((current) => !current)}
            className="mt-3 flex min-h-10 w-full items-center justify-between rounded-lg bg-white/10 px-3 text-left text-xs font-black text-slate-100 active:scale-[0.99]"
          >
            <span className="inline-flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-orange-300" />
              Voice options
            </span>
            <span>{settingsOpen ? "Hide" : "Edit"}</span>
          </button>

          {settingsOpen ? (
            <div className="mt-3 space-y-2">
              <label className="block">
                <span className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                  <Languages className="h-3.5 w-3.5" />
                  Language
                </span>
                <select
                  value={config.language}
                  onChange={(event) => updateLanguage(event.target.value)}
                  className="min-h-10 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-sm font-bold text-white"
                >
                  {DEFAULT_VOICE_LANGUAGE_OPTIONS.map((language) => (
                    <option key={language.code} value={language.code}>
                      {language.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                  Voice
                </span>
                <select
                  value={config.synthesis.voiceURI ?? ""}
                  onChange={(event) => updateVoice(event.target.value)}
                  className="min-h-10 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-sm font-bold text-white"
                >
                  <option value="">System default</option>
                  {voices.map((voice) => (
                    <option key={voice.voiceURI} value={voice.voiceURI}>
                      {voice.name} ({voice.lang})
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                  Speed
                </span>
                <input
                  type="range"
                  min="0.5"
                  max="1.5"
                  step="0.05"
                  value={config.synthesis.rate}
                  onChange={(event) =>
                    updateConfig({
                      synthesis: {
                        ...config.synthesis,
                        rate: Number(event.target.value),
                      },
                    })
                  }
                  className="w-full accent-orange-500"
                />
              </label>

              <label className="flex min-h-10 items-center justify-between gap-3 rounded-lg bg-white/8 px-3 text-xs font-black text-slate-100">
                Speak confirmations
                <input
                  type="checkbox"
                  checked={config.autoSpeakResponses}
                  onChange={(event) =>
                    updateConfig({ autoSpeakResponses: event.target.checked })
                  }
                  className="h-5 w-5 accent-orange-500"
                />
              </label>
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}

function loadStoredVoiceConfig(): VoiceLayerConfig {
  if (typeof window === "undefined") return normalizeVoiceLayerConfig();
  const stored = window.localStorage.getItem(VOICE_CONFIG_STORAGE_KEY);
  if (!stored) return normalizeVoiceLayerConfig();
  try {
    return normalizeVoiceLayerConfig(JSON.parse(stored) as Partial<VoiceLayerConfig>);
  } catch {
    return normalizeVoiceLayerConfig();
  }
}

function confirmationForIntent(intent: VoiceCommandIntent): string {
  switch (intent.type) {
    case "navigate":
      return `Opening ${intent.target}.`;
    case "search":
      return `Searching registered teams for ${intent.query}.`;
    case "refresh":
      return "Refreshing tournament data.";
    case "dictation":
      return `Searching registered teams for ${intent.text}.`;
    case "read-screen":
      return "Reading this screen.";
    case "stop-speaking":
      return "Stopping audio.";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Voice action failed.";
}

function readableDomText() {
  if (typeof document === "undefined") return "";
  return document.querySelector("[data-voice-readable='true']")?.textContent ?? "";
}
