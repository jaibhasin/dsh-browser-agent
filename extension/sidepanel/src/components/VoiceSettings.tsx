import { useEffect, useState } from "react";
import { defaultVoiceModel, VOICE_PROVIDER_API_KEY_URLS, VOICE_PROVIDER_LABELS, VOICE_PROVIDER_MODELS, VOICE_PROVIDERS, type VoiceConfig, type VoiceProvider } from "../../../../shared/voice";

type VoiceSettingsProps = {
  open: boolean;
  config?: VoiceConfig;
  busy: boolean;
  error: string;
  browserSupported: boolean;
  onClose: () => void;
  onSave: (config: VoiceConfig) => Promise<void>;
};

const PICKER_LABELS: Record<VoiceProvider, string> = {
  browser: "Browser",
  groq: "Groq",
  openrouter: "OpenRouter",
  deepgram: "Deepgram",
  elevenlabs: "ElevenLabs",
};

export function VoiceSettings({ open, config, busy, error, browserSupported, onClose, onSave }: VoiceSettingsProps) {
  const [choosingProvider, setChoosingProvider] = useState(true);
  const [provider, setProvider] = useState<VoiceProvider>(config?.provider ?? "browser");
  const [apiKey, setApiKey] = useState(config?.apiKey ?? "");
  const [model, setModel] = useState(config?.model ?? defaultVoiceModel(config?.provider ?? "browser") ?? "");

  useEffect(() => {
    if (!open) return;
    setChoosingProvider(true);
    setProvider(config?.provider ?? "browser");
    setApiKey(config?.apiKey ?? "");
    setModel(config?.model ?? defaultVoiceModel(config?.provider ?? "browser") ?? "");
  }, [config, open]);

  if (!open) return null;
  const needsKey = provider !== "browser";
  const modelOptions = VOICE_PROVIDER_MODELS[provider];
  const modelSelectOptions = modelOptions.some((option) => option.id === model) || !model
    ? modelOptions
    : [{ id: model, label: model, description: "Saved model" }, ...modelOptions];
  const apiKeyUrl = VOICE_PROVIDER_API_KEY_URLS[provider];

  const chooseProvider = (nextProvider: VoiceProvider) => {
    setProvider(nextProvider);
    setApiKey(nextProvider === config?.provider ? config?.apiKey ?? "" : "");
    setModel(nextProvider === config?.provider ? config?.model ?? defaultVoiceModel(nextProvider) ?? "" : defaultVoiceModel(nextProvider) ?? "");
    setChoosingProvider(false);
  };

  return (
    <div className="voice-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="voice-modal" role="dialog" aria-modal="true" aria-labelledby="voice-settings-title">
        <div className="voice-modal-header">
          {!choosingProvider && (
            <button type="button" className="voice-modal-back" onClick={() => setChoosingProvider(true)} disabled={busy} aria-label="Back to voice providers">←</button>
          )}
          <div>
            <span className="voice-modal-eyebrow">Voice input</span>
            <h2 id="voice-settings-title">{choosingProvider ? "Choose a provider" : PICKER_LABELS[provider]}</h2>
          </div>
          <button type="button" className="voice-modal-close" onClick={onClose} disabled={busy} aria-label="Close voice settings">×</button>
        </div>

        {choosingProvider ? (
          <div className="voice-provider-list">
            {VOICE_PROVIDERS.map((candidate) => (
              <button
                type="button"
                className={`voice-provider-option${candidate === config?.provider ? " selected" : ""}`}
                key={candidate}
                onClick={() => chooseProvider(candidate)}
                disabled={busy}
              >
                <strong>{PICKER_LABELS[candidate]}</strong>
                <span aria-hidden="true">{candidate === config?.provider ? "✓" : "›"}</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            {provider === "browser" ? (
              <p className="voice-setup-note">Uses Chrome. No API key needed.</p>
            ) : (
              <>
                <label className="voice-field">
                  <span>API key</span>
                  <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={`Paste ${VOICE_PROVIDER_LABELS[provider]} key`} autoComplete="off" disabled={busy} />
                </label>
                {apiKeyUrl && (
                  <a className="voice-api-key-link" href={apiKeyUrl} target="_blank" rel="noreferrer">
                    Get API key <span aria-hidden="true">↗</span>
                  </a>
                )}
                <label className="voice-field">
                  <span>Model</span>
                  <select value={model} onChange={(event) => setModel(event.target.value)} disabled={busy}>
                    {modelSelectOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </label>
              </>
            )}

            {provider === "browser" && !browserSupported && <p className="voice-warning">Browser dictation is unavailable in this Chrome version.</p>}
            <p className="voice-privacy">{provider === "browser" ? "Chrome handles recognition." : `Audio goes to ${VOICE_PROVIDER_LABELS[provider]}. Your key stays in extension settings.`}</p>
            {error && <p className="voice-error" role="alert">{error}</p>}
            <div className="voice-modal-actions">
              <button type="button" onClick={() => setChoosingProvider(true)} disabled={busy}>Back</button>
              <button type="button" className="voice-primary" onClick={() => void onSave({ version: 1, provider, ...(needsKey && apiKey.trim() ? { apiKey: apiKey.trim() } : {}), ...(needsKey && model ? { model } : {}) })} disabled={busy || (needsKey && (!apiKey.trim() || !model))}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
