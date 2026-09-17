import { type FormEvent, type KeyboardEvent } from "react";
import { DOCUMENT_EXTENSIONS, IMAGE_MEDIA_TYPES } from "../../../../shared/protocol";
import { type DraftDocument } from "../document-attachments";
import { draftImageDataUrl, type DraftImage } from "../image-attachments";

import type * as React from "react";
import { SlashCommandPalette } from "./SlashCommandPalette";

type ComposerProps = {
  paletteVisible: boolean;
  paletteMatches: readonly { id: string; label: string; description: string; kind?: "command" | "task"; }[];
  paletteActive: { id: string; label: string; description: string; kind?: "command" | "task"; } | undefined;
  paletteTitle?: string;
  paletteAriaLabel?: string;
  paletteEmptyMessage?: string;
  taskMenuOpen: boolean;
  themeMenuOpen: boolean;
  executeSlashCommand: (commandId: string, args?: string[]) => void;
  isAddingImage: boolean;
  sendMessage: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  isLoading: boolean;
  addAttachmentFiles: (files: readonly File[]) => Promise<void>;
  draftImages: DraftImage[];
  setDraftImages: React.Dispatch<React.SetStateAction<DraftImage[]>>;
  draftDocuments: DraftDocument[];
  setDraftDocuments: React.Dispatch<React.SetStateAction<DraftDocument[]>>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  prompt: string;
  setPrompt: React.Dispatch<React.SetStateAction<string>>;
  setActivePaletteIndex: React.Dispatch<React.SetStateAction<number>>;
  handlePromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  addImageFiles: (files: readonly File[]) => Promise<void>;
  imageInputRef: React.RefObject<HTMLInputElement | null>;
  documentInputRef: React.RefObject<HTMLInputElement | null>;
  attachmentMenuOpen: boolean;
  setAttachmentMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  toolsMenuOpen: boolean;
  stopMessage: () => Promise<void>;
  isStopping: boolean;
  connectionStatus: string;
  voiceProvider?: string;
  voiceState?: "idle" | "listening" | "transcribing" | "error";
  voiceError?: string;
  voicePartialTranscript?: string;
  voiceElapsedMs?: number;
  voiceStart?: () => void;
  voiceStop?: () => void;
  voiceOpenSetup?: () => void;
};

export function Composer({
  paletteVisible,
  paletteMatches,
  paletteActive,
  paletteTitle,
  paletteAriaLabel,
  paletteEmptyMessage,
  taskMenuOpen,
  themeMenuOpen,
  executeSlashCommand,
  isAddingImage,
  sendMessage,
  isLoading,
  addAttachmentFiles,
  draftImages,
  setDraftImages,
  draftDocuments,
  setDraftDocuments,
  textareaRef,
  prompt,
  setPrompt,
  setActivePaletteIndex,
  handlePromptKeyDown,
  addImageFiles,
  imageInputRef,
  documentInputRef,
  attachmentMenuOpen,
  setAttachmentMenuOpen,
  toolsMenuOpen,
  stopMessage,
  isStopping,
  connectionStatus,
  voiceProvider,
  voiceState = "idle",
  voiceError,
  voicePartialTranscript,
  voiceElapsedMs = 0,
  voiceStart,
  voiceStop,
  voiceOpenSetup,
}: ComposerProps) {
  const voiceActive = voiceState === "listening" || voiceState === "transcribing";
  const voiceLabel = voiceState === "listening"
    ? `Stop voice recording (${formatVoiceElapsed(voiceElapsedMs)})`
    : voiceState === "transcribing" ? "Cancel transcription" : "Dictate message";
  return (
    <>
      <SlashCommandPalette
        visible={paletteVisible}
        commands={paletteMatches}
        activeId={paletteActive?.id}
        title={paletteTitle ?? (themeMenuOpen ? "Choose a theme" : undefined)}
        ariaLabel={paletteAriaLabel ?? (themeMenuOpen ? "Theme options" : undefined)}
        emptyMessage={paletteEmptyMessage}
        onExecute={executeSlashCommand}
      />

      <div
        className="composer-drop-zone"
        onDragOver={(event) => {
          if (!isLoading && [...event.dataTransfer.types].includes("Files")) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          const imageFiles = [...event.dataTransfer.files].filter((file) => file.type.startsWith("image/"));
          void addImageFiles(imageFiles);
        }}
      >
        <form className={`composer${isAddingImage ? " composer-busy" : ""}`} onSubmit={sendMessage}>
        <label className="sr-only" htmlFor="prompt">Message the browser agent</label>
        {draftImages.length > 0 && (
          <div className="image-draft-list" aria-label="Images to attach">
            {draftImages.map((image, index) => (
              <div className="image-draft" key={image.id}>
                <img src={draftImageDataUrl(image)} alt={image.name || `Image ${index + 1}`} />
                <button
                  type="button"
                  className="image-draft-remove"
                  aria-label={`Remove ${image.name || `image ${index + 1}`}`}
                  title="Remove image"
                  onClick={() => setDraftImages((current) => current.filter((candidate) => candidate.id !== image.id))}
                  disabled={isAddingImage || isLoading}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {draftDocuments.length > 0 && (
          <div className="document-draft-list" aria-label="Files to attach">
            {draftDocuments.map((document) => (
              <div className="document-draft" key={document.id}>
                <span className="document-draft-icon" aria-hidden="true">{document.extension.toUpperCase()}</span>
                <span className="document-draft-name" title={document.name}>{document.name}</span>
                <button
                  type="button"
                  className="image-draft-remove"
                  aria-label={`Remove ${document.name}`}
                  title="Remove file"
                  onClick={() => setDraftDocuments((current) => current.filter((candidate) => candidate.id !== document.id))}
                  disabled={isAddingImage || isLoading}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          id="prompt"
          name="prompt"
          rows={1}
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
            setActivePaletteIndex(0);
          }}
          onKeyDown={handlePromptKeyDown}
          onPaste={(event) => {
            const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
            if (files.length > 0) {
              event.preventDefault();
              void addImageFiles(files);
            }
          }}
          placeholder="Ask the browser agent..."
          autoComplete="off"
        />
        {(voicePartialTranscript || voiceError) && (
          <div className={`voice-inline-status${voiceError ? " voice-inline-error" : ""}`} role={voiceError ? "alert" : "status"}>
            <span className="voice-inline-dot" aria-hidden="true" />
            <span title={voiceError || voicePartialTranscript}>{voiceError || voicePartialTranscript}</span>
            {voiceError && <>
              <button type="button" onClick={voiceStart}>Retry</button>
              <button type="button" onClick={voiceOpenSetup}>Voice settings</button>
            </>}
          </div>
        )}
        <div className="composer-footer">
          <input
            ref={imageInputRef}
            className="image-file-input"
            type="file"
            accept={IMAGE_MEDIA_TYPES.join(",")}
            multiple
            tabIndex={-1}
            onChange={(event) => void addImageFiles([...event.target.files ?? []])}
          />
          <input
            ref={documentInputRef}
            className="image-file-input"
            type="file"
            accept={DOCUMENT_EXTENSIONS.map((extension) => `.${extension}`).join(",")}
            multiple
            tabIndex={-1}
            onChange={(event) => void addAttachmentFiles([...event.target.files ?? []])}
          />
          {attachmentMenuOpen && (
            <div className="attachment-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setAttachmentMenuOpen(false); imageInputRef.current?.click(); }}>
                Add photos
              </button>
              <button type="button" role="menuitem" onClick={() => { setAttachmentMenuOpen(false); documentInputRef.current?.click(); }}>
                Add files
              </button>
            </div>
          )}
          <button
            type="button"
            className="attach-button"
            onClick={() => setAttachmentMenuOpen((open) => !open)}
            disabled={isAddingImage || isLoading}
            aria-label="Attach files"
            title="Attach files"
            aria-haspopup="menu"
            aria-expanded={attachmentMenuOpen}
          >
            {isAddingImage ? "…" : "＋"}
          </button>
          <button
            type="button"
            className={`voice-button${voiceActive ? " voice-button-active" : ""}${voiceState === "error" ? " voice-button-error" : ""}`}
            onClick={voiceActive ? voiceStop : voiceStart}
            disabled={isAddingImage || isLoading}
            aria-label={voiceLabel}
            title={voiceProvider ? `${voiceLabel} · ${voiceProvider}` : voiceLabel}
          >
            {voiceState === "transcribing" ? "…" : <svg className="voice-mic-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 10.5a2.25 2.25 0 0 0 2.25-2.25V4.25a2.25 2.25 0 1 0-4.5 0v4A2.25 2.25 0 0 0 8 10.5Zm-3.75-2.25a.75.75 0 0 0-1.5 0 5.25 5.25 0 0 0 4.5 5.19V15h1.5v-1.56a5.25 5.25 0 0 0 4.5-5.19.75.75 0 0 0-1.5 0 3.75 3.75 0 0 1-7.5 0ZM8 1.25a3 3 0 0 1 3 3v4a3 3 0 1 1-6 0v-4a3 3 0 0 1 3-3Z" /></svg>}
          </button>
          <span className="composer-hint">{toolsMenuOpen ? "Choose which tools this chat may use · Esc to close" : themeMenuOpen ? "Arrow keys choose theme · Enter to apply · Esc to cancel" : taskMenuOpen ? "Arrow keys choose a task · Enter to run · Esc to clear" : paletteVisible ? "Enter to run command · Esc to clear" : "Type / for commands · Enter to send · Shift + Enter for a new line"}</span>
          <button
            className={`send-button${isLoading ? " send-button-stop" : ""}`}
            type={isLoading ? "button" : "submit"}
            onClick={isLoading ? () => void stopMessage() : undefined}
            aria-label={isStopping ? "Stopping agent" : isLoading ? "Stop agent" : "Send message"}
            title={isStopping ? "Stopping agent" : isLoading ? "Stop agent" : "Send message"}
            disabled={isStopping || voiceActive || (!isLoading && (connectionStatus !== "connected" || toolsMenuOpen))}
          >
            {isLoading ? <span className="stop-indicator" aria-hidden="true" /> : (
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M14.7 1.3a.75.75 0 0 0-.78-.17l-12 4.5a.75.75 0 0 0 .05 1.42l5.07 1.69 1.69 5.07a.75.75 0 0 0 1.42.05l4.5-12a.75.75 0 0 0 .05-.56ZM8.3 8.76l-.68-2.04 4.42-2.21-3.74 4.25Zm.47 3.06-1.18-3.55 4.32-4.9-3.14 8.45Z" /></svg>
            )}
          </button>
        </div>
        </form>
      </div>
    </>
  );
}

function formatVoiceElapsed(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
