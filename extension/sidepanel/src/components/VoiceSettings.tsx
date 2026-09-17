import { useEffect, useState } from "react";
import { VOICE_PROVIDER_HELP, VOICE_PROVIDER_LABELS, VOICE_PROVIDERS, type VoiceConfig, type VoiceProvider } from "../../../../shared/voice";

type VoiceSettingsProps = {
  open: boolean;
  config?: VoiceConfig;
  busy: boolean;
  error: string;
  browserSupported: boolean;
  onClose: () => void;
  onSave: (config: VoiceConfig) => Promise<void>;
};

export function VoiceSettings({ open, config, busy, error, browserSupported, onClose, onSave }: VoiceSettingsProps) {
  const [provider, setProvider] = useState<VoiceProvider>(config?.provider ?? "browser");
  const [apiKey, setApiKey] = useState(config?.apiKey ?? "");

  useEffect(() => {
    if (!open) return;
    setProvider(config?.provider ?? "browser");
    setApiKey(config?.apiKey ?? "");
  }, [config, open]);

  if (!open) return null;
  const needsKey = provider !== "browser";
  return (
    <div className="voice-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="voice-modal" role="dialog" aria-modal="true" aria-labelledby="voice-settings-title">
        <div className="voice-modal-header">
          <div>
            <span className="voice-modal-eyebrow">Voice input</span>
            <h2 id="voice-settings-title">Choose your transcription engine</h2>
          </div>
          <button type="button" className="voice-modal-close" onClick={onClose} disabled={busy} aria-label="Close voice settings">×</button>
        </div>
        <label className="voice-field">
          <span>Provider</span>
          <select value={provider} onChange={(event) => {
            const nextProvider = event.target.value as VoiceProvider;
            setProvider(nextProvider);
            setApiKey(nextProvider === config?.provider ? config?.apiKey ?? "" : "");
          }} disabled={busy}>
            {VOICE_PROVIDERS.map((candidate) => <option key={candidate} value={candidate}>{VOICE_PROVIDER_LABELS[candidate]}</option>)}
          </select>
        </label>
        <p className="voice-help">{VOICE_PROVIDER_HELP[provider]}</p>
        {provider === "browser" && !browserSupported && <p className="voice-warning">Browser dictation is unavailable here. Select a provider with an API key to use voice input.</p>}
        {needsKey && (
          <label className="voice-field">
            <span>{VOICE_PROVIDER_LABELS[provider]} API key</span>
            <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Paste your API key" autoComplete="off" disabled={busy} />
          </label>
        )}
        <p className="voice-privacy">Every provider needs microphone access here to capture audio. Audio is sent to the selected provider for transcription. Provider limits and charges may apply. Keys stay in this extension's settings and are never added to chat text.</p>
        {error && <p className="voice-error" role="alert">{error}</p>}
        <div className="voice-modal-actions">
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="voice-primary" onClick={() => void onSave({ version: 1, provider, ...(needsKey && apiKey.trim() ? { apiKey: apiKey.trim() } : {}) })} disabled={busy || (needsKey && !apiKey.trim())}>
            {busy ? "Saving…" : "Save provider"}
          </button>
        </div>
      </section>
    </div>
  );
}
