# Voice input implementation plan

Goal: let users dictate into the existing composer, review the text, and send it normally.
Voice configuration is independent of the chat provider.

## 1. Verify browser support first

- [ ] Prototype microphone permission and browser speech recognition inside the actual Chrome side panel.
- [ ] Test permission approval, denial, reopening the panel, and recognition availability on macOS and Windows.
- [ ] Distinguish browser recognition from OS dictation; do not promise offline processing unless verified.
- [ ] Keep Browser dictation visible but unavailable with an explanation when unsupported.

## 2. Add setup and settings

- [x] Add a mic button to `extension/sidepanel/src/components/Composer.tsx`.
- [x] First click opens a picker: Browser dictation, Groq, OpenRouter, Deepgram, ElevenLabs Scribe.
- [x] Add `/voice-config` to the existing command list and handler in `useSidepanelController.ts` to reopen the same settings.
- [x] Show only the selected provider's required fields; preserve the saved key for the currently selected provider.
- [x] Explain where audio is processed and that provider limits or charges may apply.
- [x] Save the selected provider and configuration through the extension settings boundary, keeping keys out of logs and transcripts.
- [x] After setup, mic clicks start recording directly; request microphone permission only when needed.

## 3. Implement provider adapters

- [x] Use one common controller contract for start, stop, cancel, partial transcript, final transcript, and errors.
- [x] Implement Browser dictation, then Groq and OpenRouter, then Deepgram and ElevenLabs Scribe.
- [x] Select a sensible default transcription model per provider; keep model selection out of initial setup.
- [x] Verify current API contracts and extension compatibility for each provider before implementation.
- [x] Support final transcription for all providers and live partial text where supported.
- [x] Keep credentials and remote requests behind the extension service-worker boundary.

## 4. Make recording predictable

- [x] Show clear idle, listening, transcribing, and error states, with a recording timer and cancel action.
- [x] Click once to record and again to stop; never send the message automatically.
- [x] Preserve existing draft text and edits made during transcription; keep partial text separate and insert the final result once.
- [x] Stop microphone tracks and connections on stop, cancel, panel close, or provider change.
- [x] Ignore late results after cancellation or chat changes so text cannot land in the wrong draft.
- [x] Set a bounded recording duration and request timeout; handle silence, denied permissions, missing microphones, invalid keys, quota errors, and network failures without losing the draft.
- [x] Never silently switch providers or upload audio to a provider the user did not select.

## 5. Validate and ship

- [ ] Test first-use setup, saved configuration, `/voice-config`, provider switching, and key reuse in the real extension.
- [ ] Run a real recording through each of the five providers; verify final text, cancellation, and microphone cleanup.
- [ ] Check short and long prompts, accents, mixed-language speech, and typing while transcription is pending.
- [x] Add focused automated coverage for voice configuration validation and provider selection.
- [x] Run relevant type checks, tests, and build; live browser and provider recording coverage remains open.

Initial scope excludes spoken replies, wake words, continuous listening, and local desktop-app integration.
