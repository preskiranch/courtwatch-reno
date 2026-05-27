export type VoiceLanguageOption = {
  code: string;
  label: string;
};

export type VoiceRecognitionResult = {
  transcript: string;
  confidence: number | null;
  isFinal: boolean;
  language: string;
};

export type VoiceSynthesisVoice = {
  name: string;
  lang: string;
  voiceURI: string;
  default: boolean;
  localService: boolean;
};

export type VoiceLayerSupport = {
  recognition: boolean;
  synthesis: boolean;
  voices: boolean;
};

export type VoiceRecognitionConfig = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  timeoutMs: number;
};

export type VoiceSynthesisConfig = {
  lang: string;
  voiceURI: string | null;
  rate: number;
  pitch: number;
  volume: number;
};

export type VoiceLayerConfig = {
  language: string;
  recognition: VoiceRecognitionConfig;
  synthesis: VoiceSynthesisConfig;
  autoSpeakResponses: boolean;
};

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export const DEFAULT_VOICE_LANGUAGE_OPTIONS: VoiceLanguageOption[] = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "es-US", label: "Spanish (US)" },
  { code: "es-MX", label: "Spanish (Mexico)" },
  { code: "fr-FR", label: "French" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
];

export const DEFAULT_VOICE_LAYER_CONFIG: VoiceLayerConfig = {
  language: "en-US",
  recognition: {
    lang: "en-US",
    continuous: false,
    interimResults: true,
    maxAlternatives: 1,
    timeoutMs: 12_000,
  },
  synthesis: {
    lang: "en-US",
    voiceURI: null,
    rate: 1,
    pitch: 1,
    volume: 1,
  },
  autoSpeakResponses: true,
};
