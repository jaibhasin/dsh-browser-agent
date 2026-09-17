import type { VoiceTranscriptionRequest } from "./voice.ts";

export function formatVoiceProviderError(provider: VoiceTranscriptionRequest["provider"], status: number, payload?: unknown): string {
  const detail = providerErrorDetail(payload) ?? "The voice provider rejected the recording.";
  const lower = detail.toLowerCase();
  if (status === 402 || lower.includes("credit") || lower.includes("balance") || lower.includes("payment required")) {
    return provider === "openrouter"
      ? "OpenRouter needs credits for transcription. Add credits or choose another provider."
      : "The voice provider account has no credits. Add credits or choose another provider.";
  }
  if (status === 401 || status === 403 || lower.includes("invalid api") || lower.includes("unauthorized")) return "The voice API key was rejected. Check it in /voice-config.";
  if (status === 429 || lower.includes("quota") || lower.includes("rate limit") || lower.includes("limit exceeded")) return "The voice provider limit was reached. Try again later or choose another provider.";
  if (status === 404 || ((status === 400 || status === 422) && lower.includes("model")) || lower.includes("model not found") || lower.includes("unknown model") || lower.includes("unsupported model")) return "The selected voice model is unavailable. Choose another model in Voice settings.";
  if ((status === 400 || status === 422) && (lower.includes("audio") || lower.includes("format") || lower.includes("file"))) return "The voice provider could not read this recording. Try another model or provider.";
  if (status === 400 || status === 422) return "The voice provider rejected this recording. Check the selected model in Voice settings.";
  if (status >= 500) return "The voice provider is temporarily unavailable. Try again later.";
  return "The voice provider could not transcribe this recording.";
}

function providerErrorDetail(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const error = value as { error?: unknown; message?: unknown; detail?: unknown };
  return [error.error, error.message, error.detail]
    .map((candidate) => {
      if (typeof candidate === "string") return candidate;
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
      const nested = candidate as { message?: unknown; detail?: unknown; error?: unknown };
      return [nested.message, nested.detail, nested.error].find((part): part is string => typeof part === "string");
    })
    .find((candidate): candidate is string => Boolean(candidate));
}
