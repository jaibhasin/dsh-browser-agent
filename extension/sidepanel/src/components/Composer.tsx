import { type FormEvent, type KeyboardEvent } from "react";
import { DOCUMENT_EXTENSIONS, IMAGE_MEDIA_TYPES } from "../../../../shared/protocol";
import { type DraftDocument } from "../document-attachments";
import { draftImageDataUrl, type DraftImage } from "../image-attachments";

import type * as React from "react";
import { SlashCommandPalette } from "./SlashCommandPalette";

type ComposerProps = {
  paletteVisible: boolean;
  paletteMatches: { id: string; label: string; description: string; }[];
  paletteActive: { id: string; label: string; description: string; } | undefined;
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
};

export function Composer({
  paletteVisible,
  paletteMatches,
  paletteActive,
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
}: ComposerProps) {
  return (
    <>
      <SlashCommandPalette
        visible={paletteVisible}
        commands={paletteMatches}
        activeId={paletteActive?.id}
        onExecute={executeSlashCommand}
      />

      <form
        className={`composer${isAddingImage ? " composer-busy" : ""}`}
        onSubmit={sendMessage}
        onDragOver={(event) => {
          if (!isLoading && [...event.dataTransfer.types].includes("Files")) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          void addAttachmentFiles([...event.dataTransfer.files]);
        }}
      >
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
          <span className="composer-hint">{toolsMenuOpen ? "Choose which tools this chat may use · Esc to close" : paletteVisible ? "Enter to run command · Esc to clear" : "Enter to send · Shift + Enter for a new line · Type / for commands"}</span>
          <button
            className={`send-button${isLoading ? " send-button-stop" : ""}`}
            type={isLoading ? "button" : "submit"}
            onClick={isLoading ? () => void stopMessage() : undefined}
            aria-label={isStopping ? "Stopping agent" : isLoading ? "Stop agent" : "Send message"}
            title={isStopping ? "Stopping agent" : isLoading ? "Stop agent" : "Send message"}
            disabled={isStopping || (!isLoading && (connectionStatus !== "connected" || toolsMenuOpen))}
          >
            {isLoading ? <span className="stop-indicator" aria-hidden="true" /> : (
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M14.7 1.3a.75.75 0 0 0-.78-.17l-12 4.5a.75.75 0 0 0 .05 1.42l5.07 1.69 1.69 5.07a.75.75 0 0 0 1.42.05l4.5-12a.75.75 0 0 0 .05-.56ZM8.3 8.76l-.68-2.04 4.42-2.21-3.74 4.25Zm.47 3.06-1.18-3.55 4.32-4.9-3.14 8.45Z" /></svg>
            )}
          </button>
        </div>
      </form>
    </>
  );
}
