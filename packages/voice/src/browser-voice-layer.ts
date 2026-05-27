import { normalizeVoiceLayerConfig, sanitizeSpeakableText } from "./config.js";
import type {
  DeepPartial,
  VoiceLayerConfig,
  VoiceLayerSupport,
  VoiceRecognitionResult,
  VoiceSynthesisVoice,
} from "./types.js";

type SpeechRecognitionAlternativeLike = {
  transcript: string;
  confidence?: number;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
};

type SpeechRecognitionResultListLike = {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
};

type BrowserSpeechRecognitionEvent = Event & {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
};

type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

type BrowserVoiceWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export type ListenCallbacks = {
  onInterimResult?: (result: VoiceRecognitionResult) => void;
};

export class BrowserVoiceLayer {
  private readonly targetWindow: BrowserVoiceWindow | undefined;

  constructor(targetWindow?: Window) {
    this.targetWindow = targetWindow as BrowserVoiceWindow | undefined;
  }

  getSupport(): VoiceLayerSupport {
    const speechSynthesis = this.targetWindow?.speechSynthesis;
    return {
      recognition: Boolean(this.recognitionConstructor()),
      synthesis: Boolean(speechSynthesis),
      voices: Boolean(speechSynthesis?.getVoices().length),
    };
  }

  getVoices(): VoiceSynthesisVoice[] {
    return (
      this.targetWindow?.speechSynthesis
        ?.getVoices()
        .map((voice) => ({
          name: voice.name,
          lang: voice.lang,
          voiceURI: voice.voiceURI,
          default: voice.default,
          localService: voice.localService,
        })) ?? []
    );
  }

  listenOnce(
    configInput: DeepPartial<VoiceLayerConfig> = {},
    callbacks: ListenCallbacks = {},
  ): Promise<VoiceRecognitionResult> {
    const SpeechRecognition = this.recognitionConstructor();
    if (!SpeechRecognition) {
      return Promise.reject(
        new Error("Speech recognition is not supported in this browser."),
      );
    }
    const config = normalizeVoiceLayerConfig(configInput);
    const recognition = new SpeechRecognition();
    recognition.lang = config.recognition.lang;
    recognition.continuous = config.recognition.continuous;
    recognition.interimResults = config.recognition.interimResults;
    recognition.maxAlternatives = config.recognition.maxAlternatives;

    return new Promise((resolve, reject) => {
      let settled = false;
      let finalResult: VoiceRecognitionResult | null = null;
      let lastResult: VoiceRecognitionResult | null = null;
      const timeout = this.targetWindow?.setTimeout(() => {
        if (settled) return;
        settled = true;
        recognition.abort();
        reject(new Error("Speech recognition timed out."));
      }, config.recognition.timeoutMs);

      const settle = (handler: () => void) => {
        if (settled) return;
        settled = true;
        if (timeout) this.targetWindow?.clearTimeout(timeout);
        handler();
      };

      recognition.onresult = (event) => {
        for (let index = event.resultIndex; index < event.results.length; index++) {
          const item = event.results[index];
          if (!item) continue;
          const alternative = item[0];
          if (!alternative?.transcript) continue;
          const result: VoiceRecognitionResult = {
            transcript: alternative.transcript.trim(),
            confidence:
              typeof alternative.confidence === "number"
                ? alternative.confidence
                : null,
            isFinal: Boolean(item.isFinal),
            language: config.recognition.lang,
          };
          lastResult = result;
          if (item.isFinal) {
            finalResult = result;
            settle(() => {
              recognition.stop();
              resolve(result);
            });
            return;
          }
          callbacks.onInterimResult?.(result);
        }
      };

      recognition.onerror = (event) => {
        settle(() =>
          reject(
            new Error(
              event.error
                ? `Speech recognition failed: ${event.error}`
                : "Speech recognition failed.",
            ),
          ),
        );
      };

      recognition.onend = () => {
        if (settled) return;
        settle(() => {
          if (finalResult) resolve(finalResult);
          else if (lastResult) resolve(lastResult);
          else reject(new Error("No speech was captured."));
        });
      };

      try {
        recognition.start();
      } catch (error) {
        settle(() => reject(error));
      }
    });
  }

  speak(
    text: string,
    configInput: DeepPartial<VoiceLayerConfig> = {},
  ): Promise<void> {
    const speechSynthesis = this.targetWindow?.speechSynthesis;
    if (!speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
      return Promise.reject(
        new Error("Speech synthesis is not supported in this browser."),
      );
    }
    const safeText = sanitizeSpeakableText(text);
    if (!safeText) return Promise.resolve();

    const config = normalizeVoiceLayerConfig(configInput);
    const utterance = new SpeechSynthesisUtterance(safeText);
    const voices = speechSynthesis.getVoices();
    const selectedVoice =
      voices.find((voice) => voice.voiceURI === config.synthesis.voiceURI) ??
      voices.find((voice) => voice.lang === config.synthesis.lang) ??
      voices.find((voice) => voice.lang.startsWith(config.language));

    utterance.lang = config.synthesis.lang;
    utterance.rate = config.synthesis.rate;
    utterance.pitch = config.synthesis.pitch;
    utterance.volume = config.synthesis.volume;
    if (selectedVoice) utterance.voice = selectedVoice;

    speechSynthesis.cancel();
    return new Promise((resolve, reject) => {
      utterance.onend = () => resolve();
      utterance.onerror = () => reject(new Error("Speech synthesis failed."));
      speechSynthesis.speak(utterance);
    });
  }

  cancelSpeaking() {
    this.targetWindow?.speechSynthesis?.cancel();
  }

  private recognitionConstructor() {
    return (
      this.targetWindow?.SpeechRecognition ??
      this.targetWindow?.webkitSpeechRecognition
    );
  }
}

export function createBrowserVoiceLayer(targetWindow?: Window) {
  return new BrowserVoiceLayer(
    targetWindow ??
      (typeof window === "undefined" ? undefined : window),
  );
}
