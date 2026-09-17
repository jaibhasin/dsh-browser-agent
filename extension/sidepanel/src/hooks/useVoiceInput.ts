import { useCallback, useEffect, useRef, useState } from "react";
import { ensureVoicePermission } from "../voice-permission";
import { canStartVoice, parseVoiceConfig, type VoiceConfig, type VoiceProvider, type VoiceRuntimeState, type VoiceTranscriptionRequest } from "../../../../shared/voice";

const MAX_RECORDING_MS = 120_000;
type SpeechRecognitionResultLike = { isFinal: boolean; 0: { transcript: string } };
type SpeechRecognitionEventLike = { resultIndex: number; results: { length: number; [index: number]: SpeechRecognitionResultLike } };
type SpeechRecognitionErrorLike = { error?: string };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type UseVoiceInputOptions = {
  prompt: string;
  setPrompt: (value: string | ((current: string) => string)) => void;
  activeSessionId: string;
  disabled?: boolean;
};

export function useVoiceInput({ prompt, setPrompt, activeSessionId, disabled = false }: UseVoiceInputOptions) {
  const [config, setConfig] = useState<VoiceConfig>();
  const [state, setState] = useState<VoiceRuntimeState>("idle");
  const [error, setError] = useState("");
  const [partialTranscript, setPartialTranscript] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [configBusy, setConfigBusy] = useState(true);
  const [configError, setConfigError] = useState("");
  const generationRef = useRef(0);
  const sessionRef = useRef(activeSessionId);
  const stateRef = useRef(state);
  const recorderRef = useRef<MediaRecorder | undefined>(undefined);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | undefined>(undefined);
  const browserFinalTextRef = useRef("");
  const browserStopRequestedRef = useRef(false);
  const requestIdRef = useRef<string | undefined>(undefined);
  const startedAtRef = useRef(0);
  const permissionPendingRef = useRef(false);

  stateRef.current = state;

  const browserRecognitionAvailable = typeof window !== "undefined" && Boolean(
    (window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition ??
    (window as Window & { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition,
  );

  useEffect(() => {
    let mounted = true;
    void chrome.runtime.sendMessage({ type: "dsh-voice-config-get" })
      .then((response: { ok?: boolean; config?: unknown }) => {
        if (!mounted) return;
        setConfig(response?.ok ? parseVoiceConfig(response.config) : undefined);
        setConfigBusy(false);
      })
      .catch(() => { if (mounted) setConfigBusy(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const previousSession = sessionRef.current;
    if (previousSession !== activeSessionId && state !== "idle") cancelVoiceInput();
    sessionRef.current = activeSessionId;
  // The active chat ID is the only value that should trigger this guard.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, state]);

  useEffect(() => {
    if (state !== "listening") return;
    const timer = window.setInterval(() => {
      const elapsed = Math.max(0, Date.now() - startedAtRef.current);
      setElapsedMs(elapsed);
      if (elapsed >= MAX_RECORDING_MS && !browserStopRequestedRef.current) {
        browserStopRequestedRef.current = true;
        if (recognitionRef.current) recognitionRef.current.stop();
        else if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [state]);

  const stopResources = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    recorderRef.current = undefined;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = undefined;
    recognitionRef.current?.abort();
    recognitionRef.current = undefined;
  }, []);

  useEffect(() => {
    const dispose = () => {
      generationRef.current += 1;
      stopResources();
    };
    window.addEventListener("pagehide", dispose);
    window.addEventListener("beforeunload", dispose);
    return () => {
      window.removeEventListener("pagehide", dispose);
      window.removeEventListener("beforeunload", dispose);
      dispose();
    };
  }, [stopResources]);

  const appendTranscript = useCallback((transcript: string) => {
    const value = transcript.trim();
    if (!value) return;
    setPrompt((current) => {
      const separator = current.length === 0 || /[\s\n]$/.test(current) ? "" : " ";
      return `${current}${separator}${value}`;
    });
  }, [setPrompt]);

  const finishWithError = useCallback((message: string, generation: number) => {
    if (generation !== generationRef.current) return;
    generationRef.current += 1;
    stopResources();
    setPartialTranscript("");
    setElapsedMs(0);
    setError(message);
    setState("error");
  }, [stopResources]);

  const finishBrowser = useCallback((generation: number) => {
    if (generation !== generationRef.current) return;
    const transcript = browserFinalTextRef.current;
    browserFinalTextRef.current = "";
    recognitionRef.current = undefined;
    setPartialTranscript("");
    setElapsedMs(0);
    setState("idle");
    if (transcript) appendTranscript(transcript);
  }, [appendTranscript]);

  const startBrowser = useCallback(() => {
    const ctor = (window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition ??
      (window as Window & { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition;
    if (!ctor) {
      setError("Browser dictation is unavailable in this version of Chrome. Choose a voice provider in /voice-config.");
      setState("error");
      return;
    }
    const generation = ++generationRef.current;
    const recognition = new ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    browserFinalTextRef.current = "";
    browserStopRequestedRef.current = false;
    recognition.onresult = (event) => {
      if (generation !== generationRef.current) return;
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) browserFinalTextRef.current += `${result[0].transcript} `;
        else interim += result[0].transcript;
      }
      setPartialTranscript(`${browserFinalTextRef.current}${interim}`.trim());
    };
    recognition.onerror = (event) => {
      if (generation !== generationRef.current || browserStopRequestedRef.current) return;
      const message = event.error === "not-allowed" || event.error === "service-not-allowed"
        ? "Chrome could not start browser dictation. Retry to check microphone access, or choose a cloud provider in Voice settings."
        : event.error === "no-speech" ? "No speech was detected. Try again when you are ready." : "Browser dictation could not start.";
      finishWithError(message, generation);
    };
    recognition.onend = () => {
      if (generation !== generationRef.current) return;
      finishBrowser(generation);
    };
    recognitionRef.current = recognition;
    setError("");
    setPartialTranscript("");
    setElapsedMs(0);
    startedAtRef.current = Date.now();
    setState("listening");
    try { recognition.start(); } catch { finishWithError("Browser dictation could not start. Try again.", generation); }
  }, [finishBrowser, finishWithError]);

  const startCloud = useCallback(async (provider: Exclude<VoiceProvider, "browser">) => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser cannot record microphone audio for the selected provider.");
      setState("error");
      return;
    }
    const generation = ++generationRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== generationRef.current || sessionRef.current !== activeSessionId) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"].find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data); };
      recorder.onerror = () => finishWithError("The microphone recording failed. Try again.", generation);
      recorder.onstop = () => {
        if (generation !== generationRef.current) return;
        for (const track of stream.getTracks()) track.stop();
        streamRef.current = undefined;
        recorderRef.current = undefined;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
        chunksRef.current = [];
        if (blob.size === 0) { finishWithError("The recording was empty. Try again.", generation); return; }
        void transcribeCloud(blob, provider, generation);
      };
      browserStopRequestedRef.current = false;
      recorder.start(250);
      setError("");
      setPartialTranscript("");
      setElapsedMs(0);
      startedAtRef.current = Date.now();
      setState("listening");
    } catch (error) {
      const message = error instanceof DOMException && error.name === "NotAllowedError"
        ? "Microphone access could not be granted. Click Retry to open the extension's microphone permission page."
        : error instanceof DOMException && error.name === "NotFoundError"
          ? "No microphone was found. Connect a microphone and try again."
          : error instanceof DOMException && error.name === "NotReadableError"
            ? "The microphone is busy or unavailable. Close other apps using it and try again."
        : "The microphone could not be opened. Check that it is connected and try again.";
      finishWithError(message, generation);
    }
  }, [activeSessionId, finishWithError]);

  const transcribeCloud = useCallback(async (blob: Blob, provider: Exclude<VoiceProvider, "browser">, generation: number) => {
    if (generation !== generationRef.current) return;
    setState("transcribing");
    setPartialTranscript("Transcribing…");
    setElapsedMs(0);
    const requestId = crypto.randomUUID();
    requestIdRef.current = requestId;
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      const chunkSize = 0x8000;
      for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
      const request: VoiceTranscriptionRequest = { provider, audioBase64: btoa(binary), mimeType: blob.type || "audio/webm" };
      const response = await chrome.runtime.sendMessage({ type: "dsh-voice-transcribe", requestId, request }) as { ok?: boolean; text?: string; error?: string };
      if (generation !== generationRef.current || sessionRef.current !== activeSessionId) return;
      if (!response?.ok || typeof response.text !== "string") throw new Error(response?.error ?? "Voice transcription failed.");
      setPartialTranscript("");
      setState("idle");
      appendTranscript(response.text);
    } catch (error) {
      if (generation !== generationRef.current) return;
      setPartialTranscript("");
      setError(error instanceof Error ? error.message : "Voice transcription failed.");
      setState("error");
    } finally {
      if (requestIdRef.current === requestId) requestIdRef.current = undefined;
    }
  }, [activeSessionId, appendTranscript]);

  const start = useCallback(() => {
    if (disabled || permissionPendingRef.current || !canStartVoice(stateRef.current)) return;
    if (stateRef.current === "error") setState("idle");
    setError("");
    if (!config) { setSetupOpen(true); return; }
    if (config.provider !== "browser" && !config.apiKey) { setSetupOpen(true); return; }
    permissionPendingRef.current = true;
    const generation = generationRef.current;
    void ensureVoicePermission().then((granted) => {
      if (generation !== generationRef.current) return;
      if (!granted) {
        setError("Allow microphone access in the tab that opened, then return here and click Retry.");
        setState("error");
        return;
      }
      if (config.provider === "browser") startBrowser();
      else return startCloud(config.provider);
    }).catch(() => {
      if (generation !== generationRef.current) return;
      setError("Microphone permissions could not be checked. Reload the extension and try again.");
      setState("error");
    }).finally(() => { permissionPendingRef.current = false; });
  }, [config, disabled, startBrowser, startCloud]);

  const stop = useCallback(() => {
    if (stateRef.current === "listening") {
      browserStopRequestedRef.current = true;
      try {
        if (recognitionRef.current) recognitionRef.current.stop();
        else if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      } catch {
        cancelVoiceInput();
      }
    } else if (stateRef.current === "transcribing") {
      const requestId = requestIdRef.current;
      generationRef.current += 1;
      if (requestId) void chrome.runtime.sendMessage({ type: "dsh-voice-transcribe-cancel", requestId }).catch(() => undefined);
      stopResources();
      requestIdRef.current = undefined;
      setPartialTranscript("");
      setState("idle");
      setElapsedMs(0);
    }
  }, [stopResources]);

  const cancelVoiceInput = useCallback(() => {
    generationRef.current += 1;
    browserStopRequestedRef.current = true;
    const requestId = requestIdRef.current;
    if (requestId) void chrome.runtime.sendMessage({ type: "dsh-voice-transcribe-cancel", requestId }).catch(() => undefined);
    requestIdRef.current = undefined;
    stopResources();
    chunksRef.current = [];
    setPartialTranscript("");
    setElapsedMs(0);
    setState("idle");
  }, [stopResources]);

  const saveConfig = useCallback(async (next: VoiceConfig) => {
    setConfigBusy(true);
    setConfigError("");
    try {
      if (config?.provider !== next.provider && stateRef.current !== "idle") cancelVoiceInput();
      const response = await chrome.runtime.sendMessage({ type: "dsh-voice-config-set", config: next }) as { ok?: boolean; config?: unknown; error?: string };
      if (!response?.ok) throw new Error(response?.error ?? "Voice settings could not be saved.");
      const saved = parseVoiceConfig(response.config) ?? next;
      setConfig(saved);
      setSetupOpen(false);
      setError("");
      setPartialTranscript("");
      setElapsedMs(0);
      setState("idle");
    } catch (saveError) {
      setConfigError(saveError instanceof Error ? saveError.message : "Voice settings could not be saved.");
    } finally { setConfigBusy(false); }
  }, [cancelVoiceInput, config]);

  const openSetup = useCallback(() => { setSetupOpen(true); setConfigError(""); setError(""); }, []);

  return {
    config,
    state,
    error,
    partialTranscript,
    setupOpen,
    setSetupOpen,
    configBusy,
    configError,
    browserRecognitionAvailable,
    elapsedMs,
    start,
    stop,
    cancel: cancelVoiceInput,
    saveConfig,
    openSetup,
    prompt,
  };
}
