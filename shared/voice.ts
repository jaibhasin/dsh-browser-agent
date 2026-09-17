export const VOICE_CONFIG_STORAGE_KEY = "dshVoiceConfigV1";

export const VOICE_PROVIDERS = ["browser", "groq", "openrouter", "deepgram", "elevenlabs"] as const;
export type VoiceProvider = (typeof VOICE_PROVIDERS)[number];

export type VoiceConfig = {
  version: 1;
  provider: VoiceProvider;
  apiKey?: string;
  model?: string;
};

export type VoiceModelOption = {
  id: string;
  label: string;
  description: string;
};

export const VOICE_PROVIDER_MODELS: Record<VoiceProvider, readonly VoiceModelOption[]> = {
  browser: [],
  groq: [
    { id: "whisper-large-v3-turbo", label: "Whisper Large V3 Turbo", description: "Fast multilingual transcription for everyday dictation." },
    { id: "whisper-large-v3", label: "Whisper Large V3", description: "Higher-accuracy multilingual transcription and translation." },
  ],
  openrouter: [
    { id: "openai/whisper-1", label: "OpenAI Whisper 1", description: "Reliable, cost-efficient transcription across 50+ languages." },
    { id: "openai/whisper-large-v3-turbo", label: "OpenAI Whisper Large V3 Turbo", description: "Fast multilingual Whisper transcription." },
    { id: "openai/whisper-large-v3", label: "OpenAI Whisper Large V3", description: "High-accuracy multilingual Whisper transcription." },
    { id: "openai/gpt-4o-mini-transcribe", label: "OpenAI GPT-4o Mini Transcribe", description: "Cost-efficient speech-to-text for high-volume use." },
    { id: "openai/gpt-4o-transcribe", label: "OpenAI GPT-4o Transcribe", description: "High-quality speech-to-text from OpenAI's audio models." },
    { id: "openai/gpt-transcribe", label: "OpenAI GPT Transcribe", description: "Accurate transcription for recorded and streamed audio." },
    { id: "microsoft/mai-transcribe-2", label: "Microsoft MAI-Transcribe 2", description: "Multilingual transcription with speaker and keyword features." },
  ],
  deepgram: [
    { id: "nova-3", label: "Nova-3", description: "Deepgram's highest-performing general-purpose model." },
    { id: "nova-2", label: "Nova-2", description: "Multilingual model with strong filler-word recognition." },
    { id: "nova-2-meeting", label: "Nova-2 Meeting", description: "Optimized for conference rooms and multiple speakers." },
    { id: "nova-2-phonecall", label: "Nova-2 Phonecall", description: "Optimized for low-bandwidth phone audio." },
    { id: "nova-2-conversationalai", label: "Nova-2 Conversational AI", description: "Optimized for voice assistants and automated agents." },
    { id: "nova-2-video", label: "Nova-2 Video", description: "Optimized for audio extracted from videos." },
    { id: "nova-2-medical", label: "Nova-2 Medical", description: "Optimized for medical vocabulary." },
  ],
  elevenlabs: [
    { id: "scribe_v2", label: "Scribe v2", description: "High-accuracy transcription with multilingual support." },
    { id: "scribe_v2_medical", label: "Scribe v2 Medical", description: "Scribe v2 tuned for clinical and medical audio." },
  ],
};

export type VoiceRuntimeState = "idle" | "listening" | "transcribing" | "error";

export type VoiceTranscriptionRequest = {
  provider: Exclude<VoiceProvider, "browser">;
  model: string;
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

export type VoiceProviderPresentation = {
  optionLabel: string;
  costLabel: string;
  setupLabel: string;
  fitLabel: string;
  apiKeyUrl?: string;
};

export const VOICE_PROVIDER_PRESENTATION: Record<VoiceProvider, VoiceProviderPresentation> = {
  browser: {
    optionLabel: "Browser dictation (Free · no API key)",
    costLabel: "Free",
    setupLabel: "No API key",
    fitLabel: "Quickest setup",
  },
  groq: {
    optionLabel: "Groq (Free tier · API key)",
    costLabel: "Free tier",
    setupLabel: "API key needed",
    fitLabel: "Fast cloud option",
    apiKeyUrl: "https://console.groq.com/keys",
  },
  openrouter: {
    optionLabel: "OpenRouter (Credits · API key)",
    costLabel: "Credits required",
    setupLabel: "API key needed",
    fitLabel: "Most model choice",
    apiKeyUrl: "https://openrouter.ai/settings/keys",
  },
  deepgram: {
    optionLabel: "Deepgram (Free credits · API key)",
    costLabel: "Free credits",
    setupLabel: "API key needed",
    fitLabel: "Fast and accurate",
    apiKeyUrl: "https://console.deepgram.com/",
  },
  elevenlabs: {
    optionLabel: "ElevenLabs Scribe (Free tier · API key)",
    costLabel: "Free tier",
    setupLabel: "API key needed",
    fitLabel: "Strong multilingual",
    apiKeyUrl: "https://elevenlabs.io/app/developers/api-keys",
  },
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
  const candidate = value as { version?: unknown; provider?: unknown; apiKey?: unknown; model?: unknown };
  if (candidate.version !== 1 || !isVoiceProvider(candidate.provider)) return undefined;
  if (candidate.provider === "browser") return { version: 1, provider: "browser" };
  if (candidate.apiKey !== undefined && (typeof candidate.apiKey !== "string" || candidate.apiKey.length > 512)) return undefined;
  if (candidate.model !== undefined && (typeof candidate.model !== "string" || candidate.model.trim().length === 0 || candidate.model.length > 200)) return undefined;
  const model = typeof candidate.model === "string" && candidate.model.trim() ? candidate.model.trim() : defaultVoiceModel(candidate.provider);
  return { version: 1, provider: candidate.provider, ...(candidate.apiKey ? { apiKey: candidate.apiKey } : {}), ...(model ? { model } : {}) };
}

export function defaultVoiceModel(provider: VoiceProvider): string | undefined {
  return VOICE_PROVIDER_MODELS[provider][0]?.id;
}

export function voiceProviderRequiresKey(provider: VoiceProvider): provider is Exclude<VoiceProvider, "browser"> {
  return provider !== "browser";
}

export function canStartVoice(state: VoiceRuntimeState): boolean {
  return state === "idle" || state === "error";
}
