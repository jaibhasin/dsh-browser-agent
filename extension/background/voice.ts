import { defaultVoiceModel, VOICE_CONFIG_STORAGE_KEY, parseVoiceConfig, type VoiceTranscriptionRequest } from "../../shared/voice";

const TRANSCRIPTION_TIMEOUT_MS = 60_000;
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const activeRequests = new Map<string, AbortController>();

export async function transcribeVoice(requestId: string, request: VoiceTranscriptionRequest): Promise<string> {
  if (activeRequests.has(requestId)) throw new Error("A voice request with this ID is already running.");
  const stored = await chrome.storage.local.get(VOICE_CONFIG_STORAGE_KEY);
  const config = parseVoiceConfig(stored[VOICE_CONFIG_STORAGE_KEY]);
  if (!config || config.provider !== request.provider || !config.apiKey) throw new Error("Configure a voice provider before recording.");
  const configuredModel = config.model ?? defaultVoiceModel(request.provider);
  if (!configuredModel || request.model !== configuredModel) throw new Error("The selected voice model is no longer active. Open /voice-config and save it again.");

  const bytes = decodeBase64(request.audioBase64);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_AUDIO_BYTES) throw new Error("The recording is empty or too large.");
  const controller = new AbortController();
  activeRequests.set(requestId, controller);
  const timeout = setTimeout(() => controller.abort(), TRANSCRIPTION_TIMEOUT_MS);
  try {
    const response = await fetchRequest(request, config.apiKey, bytes, controller.signal);
    if (!response.ok) throw new Error(await providerError(response));
    const payload = await response.json() as { text?: unknown; results?: { channels?: Array<{ alternatives?: Array<{ transcript?: unknown }> }> } };
    const text = request.provider === "deepgram"
      ? payload.results?.channels?.[0]?.alternatives?.[0]?.transcript
      : payload.text;
    if (typeof text !== "string" || !text.trim()) throw new Error("The provider returned no transcript.");
    return text.trim();
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Voice transcription timed out or was cancelled.");
    if (error instanceof Error && error.message.startsWith("Voice transcription")) throw error;
    throw new Error(error instanceof Error ? error.message : "Voice transcription failed.");
  } finally {
    clearTimeout(timeout);
    activeRequests.delete(requestId);
  }
}

export function cancelVoiceTranscription(requestId: string): boolean {
  const controller = activeRequests.get(requestId);
  if (!controller) return false;
  controller.abort();
  return true;
}

async function fetchRequest(request: VoiceTranscriptionRequest, apiKey: string, bytes: Uint8Array, signal: AbortSignal): Promise<Response> {
  const audioBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([audioBuffer], { type: request.mimeType || "audio/webm" });
  if (request.provider === "openrouter") {
    return fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        input_audio: { data: request.audioBase64, format: audioFormat(request.mimeType) },
      }),
      signal,
    });
  }

  const form = new FormData();
  form.append("file", blob, `dsh-voice.${audioFormat(request.mimeType)}`);
  if (request.provider === "groq") {
    form.append("model", request.model);
    form.append("response_format", "json");
    return fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal,
    });
  }
  if (request.provider === "deepgram") {
    return fetch(`https://api.deepgram.com/v1/listen?model=${encodeURIComponent(request.model)}&smart_format=true`, {
      method: "POST", headers: { Authorization: `Token ${apiKey}`, "Content-Type": request.mimeType || "audio/webm" }, body: blob, signal,
    });
  }
  form.append("model_id", request.model);
  return fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST", headers: { "xi-api-key": apiKey }, body: form, signal,
  });
}

async function providerError(response: Response): Promise<string> {
  let detail = "The voice provider rejected the recording.";
  try {
    const payload = await response.json() as { error?: unknown; message?: unknown; detail?: unknown };
    const candidate = [payload.error, payload.message, payload.detail].find((value): value is string => typeof value === "string");
    if (candidate) detail = candidate;
  } catch { /* Keep a stable message when the provider does not return JSON. */ }
  const lower = detail.toLowerCase();
  if (response.status === 401 || response.status === 403 || lower.includes("invalid api") || lower.includes("unauthorized")) return "The voice API key was rejected. Check it in /voice-config.";
  if (response.status === 429 || lower.includes("quota") || lower.includes("rate limit") || lower.includes("limit exceeded")) return "The voice provider limit was reached. Try again later or choose another provider.";
  if (response.status >= 500) return "The voice provider is temporarily unavailable. Try again later.";
  return "The voice provider could not transcribe this recording.";
}

function audioFormat(mimeType: string): string {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  return "webm";
}

function decodeBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error("The recording payload is invalid.");
  const binary = atob(value);
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) result[index] = binary.charCodeAt(index);
  return result;
}
