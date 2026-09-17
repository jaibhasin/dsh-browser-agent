export const VOICE_CONFIG_STORAGE_KEY = "dshVoiceConfigV1";

export const VOICE_PROVIDERS = ["browser", "groq", "openrouter", "deepgram", "elevenlabs"] as const;
export type VoiceProvider = (typeof VOICE_PROVIDERS)[number];

export type VoiceConfig = {
  version: 1;
  provider: VoiceProvider;
  apiKey?: string;
};

export type VoiceRuntimeState = "idle" | "listening" | "transcribing" | "error";

export type VoiceTranscriptionRequest = {
  provider: Exclude<VoiceProvider, "browser">;
  audioBase64: string;
  mimeType: string;
};

export type VoiceTranscriptionResponse = {
  text: string;
};

export const VOICE_PROVIDER_LABELS: Record<VoiceProvider, string> = {
  browser: "Browser dictation",
  groq: "Groq",
  openrouter: "OpenRouter",
  deepgram: "Deepgram",
  elevenlabs: "ElevenLabs Scribe",
};

export const VOICE_PROVIDER_HELP: Record<VoiceProvider, string> = {
  browser: "Uses Chrome's speech recognition when your browser supports it. Audio handling depends on Chrome.",
  groq: "Fast Whisper transcription from Groq. Your audio is sent to Groq using your key.",
  openrouter: "Use OpenRouter's audio transcription endpoint and its available speech models.",
  deepgram: "Deepgram Nova speech recognition with fast transcription.",
  elevenlabs: "ElevenLabs Scribe speech recognition with broad language support.",
};

export function isVoiceProvider(value: unknown): value is VoiceProvider {
  return typeof value === "string" && (VOICE_PROVIDERS as readonly string[]).includes(value);
}

export function parseVoiceConfig(value: unknown): VoiceConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as { version?: unknown; provider?: unknown; apiKey?: unknown };
  if (candidate.version !== 1 || !isVoiceProvider(candidate.provider)) return undefined;
  if (candidate.provider === "browser") return { version: 1, provider: "browser" };
  if (candidate.apiKey !== undefined && (typeof candidate.apiKey !== "string" || candidate.apiKey.length > 512)) return undefined;
  return { version: 1, provider: candidate.provider, ...(candidate.apiKey ? { apiKey: candidate.apiKey } : {}) };
}

export function voiceProviderRequiresKey(provider: VoiceProvider): provider is Exclude<VoiceProvider, "browser"> {
  return provider !== "browser";
}

export function canStartVoice(state: VoiceRuntimeState): boolean {
  return state === "idle" || state === "error";
}
