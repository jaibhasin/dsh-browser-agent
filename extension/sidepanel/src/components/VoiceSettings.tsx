import { useEffect, useState } from "react";
import { defaultVoiceModel, VOICE_PROVIDER_HELP, VOICE_PROVIDER_LABELS, VOICE_PROVIDER_MODELS, VOICE_PROVIDER_PRESENTATION, VOICE_PROVIDERS, type VoiceConfig, type VoiceProvider } from "../../../../shared/voice";

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
  const [model, setModel] = useState(config?.model ?? defaultVoiceModel(config?.provider ?? "browser") ?? "");

  useEffect(() => {
    if (!open) return;
    setProvider(config?.provider ?? "browser");
    setApiKey(config?.apiKey ?? "");
    setModel(config?.model ?? defaultVoiceModel(config?.provider ?? "browser") ?? "");
  }, [config, open]);

  if (!open) return null;
  const needsKey = provider !== "browser";
  const modelOptions = VOICE_PROVIDER_MODELS[provider];
  const selectedModel = modelOptions.find((option) => option.id === model);
  const modelSelectOptions = selectedModel || !model
    ? modelOptions
    : [{ id: model, label: `Saved model (${model})`, description: "Previously saved model selection." }, ...modelOptions];
  const providerPresentation = VOICE_PROVIDER_PRESENTATION[provider];
  return (
    <div className="voice-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="voice-modal" role="dialog" aria-modal="true" aria-labelledby="voice-settings-title">
        <div className="voice-modal-header">
          <div>
            <span className="voice-modal-eyebrow">Voice input</span>
            <h2 id="voice-settings-title">Choose your voice setup</h2>
          </div>
          <button type="button" className="voice-modal-close" onClick={onClose} disabled={busy} aria-label="Close voice settings">×</button>
        </div>
        <label className="voice-field">
          <span>Voice provider</span>
          <select value={provider} onChange={(event) => {
            const nextProvider = event.target.value as VoiceProvider;
            setProvider(nextProvider);
            setApiKey(nextProvider === config?.provider ? config?.apiKey ?? "" : "");
            setModel(defaultVoiceModel(nextProvider) ?? "");
          }} disabled={busy}>
            {VOICE_PROVIDERS.map((candidate) => <option key={candidate} value={candidate}>{VOICE_PROVIDER_PRESENTATION[candidate].optionLabel}</option>)}
          </select>
        </label>
        <div className="voice-provider-chips" aria-label={`${VOICE_PROVIDER_LABELS[provider]} setup details`}>
          <span className="voice-provider-chip voice-provider-chip-primary">{providerPresentation.fitLabel}</span>
          <span className="voice-provider-chip">{providerPresentation.costLabel}</span>
          <span className="voice-provider-chip">{providerPresentation.setupLabel}</span>
        </div>
        <p className="voice-help">{VOICE_PROVIDER_HELP[provider]}</p>
        {provider === "browser" && !browserSupported && <p className="voice-warning">Browser dictation is unavailable here. Select a provider with an API key to use voice input.</p>}
        {needsKey && (
          <>
            <label className="voice-field">
              <span>Transcription model</span>
              <select value={model} onChange={(event) => setModel(event.target.value)} disabled={busy}>
                {modelSelectOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            {selectedModel && <p className="voice-model-help">{selectedModel.description}</p>}
            <label className="voice-field">
              <span>{VOICE_PROVIDER_LABELS[provider]} API key</span>
              <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Paste your API key" autoComplete="off" disabled={busy} />
            </label>
            {providerPresentation.apiKeyUrl && (
              <a className="voice-api-key-link" href={providerPresentation.apiKeyUrl} target="_blank" rel="noreferrer">
                Get a {VOICE_PROVIDER_LABELS[provider]} API key <span aria-hidden="true">↗</span>
              </a>
            )}
          </>
        )}
        <p className="voice-privacy">Every provider needs microphone access here to capture audio. Audio is sent to the selected provider for transcription. Provider limits and charges may apply. Keys stay in this extension's settings and are never added to chat text.</p>
        {error && <p className="voice-error" role="alert">{error}</p>}
        <div className="voice-modal-actions">
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="voice-primary" onClick={() => void onSave({ version: 1, provider, ...(needsKey && apiKey.trim() ? { apiKey: apiKey.trim() } : {}), ...(needsKey && model ? { model } : {}) })} disabled={busy || (needsKey && (!apiKey.trim() || !model))}>
            {busy ? "Saving…" : `Use ${VOICE_PROVIDER_LABELS[provider]}`}
          </button>
        </div>
      </section>
    </div>
  );
}
