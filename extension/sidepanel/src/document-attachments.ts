import { DOCUMENT_EXTENSIONS, DOCUMENT_LIMITS, documentExtension, type BridgePromptContentPart, type DocumentExtension } from "../../../shared/protocol.ts";

export { DOCUMENT_EXTENSIONS, DOCUMENT_LIMITS };

export type DraftDocument = {
  id: string;
  name: string;
  extension: DocumentExtension;
  mediaType?: string;
  data: string;
  bytes: number;
};

export type DocumentInputErrorCode = "unsupported-type" | "too-many" | "file-too-large" | "message-too-large" | "invalid-name";

export class DocumentInputError extends Error {
  readonly code: DocumentInputErrorCode;
  readonly fileName?: string;
  readonly limit?: number;

  constructor(code: DocumentInputErrorCode, fileName?: string, limit?: number) {
    super(code);
    this.name = "DocumentInputError";
    this.code = code;
    this.fileName = fileName;
    this.limit = limit;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function extensionForFile(file: File): DocumentExtension | undefined {
  return documentExtension(file.name);
}

export async function prepareDocumentFiles(files: readonly File[], current: readonly DraftDocument[]): Promise<DraftDocument[]> {
  if (current.length + files.length > DOCUMENT_LIMITS.maxFilesPerMessage) {
    throw new DocumentInputError("too-many", undefined, DOCUMENT_LIMITS.maxFilesPerMessage);
  }
  let totalBytes = current.reduce((total, document) => total + document.bytes, 0);
  const prepared: DraftDocument[] = [];
  for (const file of files) {
    const extension = extensionForFile(file);
    if (!extension) throw new DocumentInputError("unsupported-type", file.name);
    if (!file.name || file.name.length > DOCUMENT_LIMITS.maxNameLength) {
      throw new DocumentInputError("invalid-name", file.name, DOCUMENT_LIMITS.maxNameLength);
    }
    if (file.size > DOCUMENT_LIMITS.maxFileBytes) {
      throw new DocumentInputError("file-too-large", file.name, DOCUMENT_LIMITS.maxFileBytes);
    }
    totalBytes += file.size;
    if (totalBytes > DOCUMENT_LIMITS.maxMessageBytes) {
      throw new DocumentInputError("message-too-large", undefined, DOCUMENT_LIMITS.maxMessageBytes);
    }
    prepared.push({
      id: crypto.randomUUID(),
      name: file.name,
      extension,
      ...(file.type ? { mediaType: file.type } : {}),
      data: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
      bytes: file.size,
    });
  }
  return prepared;
}

export function documentPromptContent(documents: readonly DraftDocument[]): BridgePromptContentPart[] {
  return documents.map((document) => ({
    type: "document" as const,
    name: document.name,
    ...(document.mediaType ? { mediaType: document.mediaType } : {}),
    data: document.data,
  }));
}

export function documentInputErrorMessage(error: unknown): string {
  if (!(error instanceof DocumentInputError)) return error instanceof Error ? error.message : "The file could not be added.";
  const name = error.fileName ?? "This file";
  switch (error.code) {
    case "unsupported-type": return `${name} is not a supported file. Use Word, PDF, CSV, Excel, PowerPoint, OpenDocument, RTF, EPUB, Markdown, or plain text.`;
    case "too-many": return `You can attach up to ${error.limit} documents per message.`;
    case "file-too-large": return `${name} is too large. The limit is ${formatBytes(error.limit ?? 0)}.`;
    case "message-too-large": return `The attached documents exceed ${formatBytes(error.limit ?? 0)} in total.`;
    case "invalid-name": return `${name || "This file"} has an invalid filename. Use a filename shorter than ${error.limit} characters.`;
  }
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024 * 10) / 10} MB` : `${Math.ceil(bytes / 1024)} KB`;
}
