import type { ChatMessage as Message } from "../chat-history";
import { draftImageDataUrl, type DraftImage } from "../image-attachments";

export function UserMessageContent({ message, images }: { message: Message; images?: DraftImage[] }) {
  const drafts = new Map((images ?? []).map((image) => [image.id, image]));
  return (
    <>
      {message.text && <p>{message.text}</p>}
      {message.images && message.images.length > 0 && (
        <div className="image-message-list" aria-label="Attached images">
          {message.images.map((image) => {
            const draft = drafts.get(image.id);
            return draft ? (
              <img key={image.id} src={draftImageDataUrl(draft)} alt={image.name || "Attached image"} />
            ) : (
              <span className="image-message-placeholder" key={image.id}>{image.name || "Attached image"}</span>
            );
          })}
        </div>
      )}
      {message.documents && message.documents.length > 0 && (
        <div className="document-message-list" aria-label="Attached files">
          {message.documents.map((document) => (
            <span className="document-message-chip" key={document.id}>
              <strong>{document.extension.toUpperCase()}</strong>
              <span title={document.name}>{document.name}</span>
            </span>
          ))}
        </div>
      )}
    </>
  );
}

