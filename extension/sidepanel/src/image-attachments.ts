import { IMAGE_MEDIA_TYPES, type BridgePromptContentPart, type ImageMediaType } from "../../../shared/protocol.ts";

export const IMAGE_LIMITS = {
  maxImageBytes: 10 * 1024 * 1024,
  maxImagesPerMessage: 4,
  maxMessageImageBytes: 20 * 1024 * 1024,
  maxImagePixels: 20_000_000,
  maxImageDimension: 8_192,
} as const;

export type DraftImage = {
  id: string;
  mediaType: ImageMediaType;
  data: string;
  bytes: number;
  width: number;
  height: number;
  name?: string;
};

export type ImageInputErrorCode = "unsupported-type" | "too-many" | "image-too-large" | "message-too-large" | "dimension-too-large" | "too-many-pixels" | "decode-failed";

export class ImageInputError extends Error {
  readonly code: ImageInputErrorCode;
  readonly imageName?: string;
  readonly limit?: number;

  constructor(code: ImageInputErrorCode, imageName?: string, limit?: number) {
    super(code);
    this.name = "ImageInputError";
    this.code = code;
    this.imageName = imageName;
    this.limit = limit;
  }
}

type MeasureImage = (file: File) => Promise<{ width: number; height: number }>;

function isImageMediaType(value: string): value is ImageMediaType {
  return (IMAGE_MEDIA_TYPES as readonly string[]).includes(value);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function measureImage(file: File): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    try {
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error("image decode failed"));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export async function prepareImageFiles(
  files: readonly File[],
  current: readonly DraftImage[],
  measure: MeasureImage = measureImage,
): Promise<DraftImage[]> {
  if (current.length + files.length > IMAGE_LIMITS.maxImagesPerMessage) {
    throw new ImageInputError("too-many", undefined, IMAGE_LIMITS.maxImagesPerMessage);
  }
  let totalBytes = current.reduce((total, image) => total + image.bytes, 0);
  for (const file of files) {
    if (!isImageMediaType(file.type)) throw new ImageInputError("unsupported-type", file.name);
    if (file.size > IMAGE_LIMITS.maxImageBytes) throw new ImageInputError("image-too-large", file.name, IMAGE_LIMITS.maxImageBytes);
    totalBytes += file.size;
    if (totalBytes > IMAGE_LIMITS.maxMessageImageBytes) throw new ImageInputError("message-too-large", undefined, IMAGE_LIMITS.maxMessageImageBytes);
  }

  const prepared: DraftImage[] = [];
  for (const file of files) {
    const mediaType = file.type;
    if (!isImageMediaType(mediaType)) throw new ImageInputError("unsupported-type", file.name);
    let dimensions: { width: number; height: number };
    try {
      dimensions = await measure(file);
    } catch {
      throw new ImageInputError("decode-failed", file.name);
    }
    if (!Number.isSafeInteger(dimensions.width) || !Number.isSafeInteger(dimensions.height) || dimensions.width < 1 || dimensions.height < 1) {
      throw new ImageInputError("decode-failed", file.name);
    }
    if (dimensions.width > IMAGE_LIMITS.maxImageDimension || dimensions.height > IMAGE_LIMITS.maxImageDimension) {
      throw new ImageInputError("dimension-too-large", file.name, IMAGE_LIMITS.maxImageDimension);
    }
    if (dimensions.width * dimensions.height > IMAGE_LIMITS.maxImagePixels) {
      throw new ImageInputError("too-many-pixels", file.name, IMAGE_LIMITS.maxImagePixels);
    }
    prepared.push({
      id: crypto.randomUUID(),
      mediaType,
      data: bytesToBase64(await readFileBytes(file)),
      bytes: file.size,
      width: dimensions.width,
      height: dimensions.height,
      ...(file.name ? { name: file.name } : {}),
    });
  }
  return prepared;
}

export function draftImageDataUrl(image: DraftImage): string {
  return `data:${image.mediaType};base64,${image.data}`;
}

export function promptContent(text: string, images: readonly DraftImage[]): BridgePromptContentPart[] {
  const content: BridgePromptContentPart[] = [];
  if (text !== "") content.push({ type: "text", text });
  content.push(...images.map((image) => ({
    type: "image" as const,
    mediaType: image.mediaType,
    data: image.data,
    ...(image.name ? { name: image.name } : {}),
  })));
  return content;
}

export function imageInputErrorMessage(error: unknown): string {
  if (!(error instanceof ImageInputError)) return error instanceof Error ? error.message : "The image could not be added.";
  const name = error.imageName ?? "This image";
  switch (error.code) {
    case "unsupported-type": return `${name} is not a supported image. Use PNG, JPEG, WebP, or GIF.`;
    case "too-many": return `You can attach up to ${error.limit} images per message.`;
    case "image-too-large": return `${name} is too large. The limit is ${formatBytes(error.limit ?? 0)}.`;
    case "message-too-large": return `The images in this message exceed ${formatBytes(error.limit ?? 0)}.`;
    case "dimension-too-large": return `${name} exceeds the ${error.limit}px width or height limit.`;
    case "too-many-pixels": return `${name} has too many pixels for safe processing.`;
    case "decode-failed": return `${name} could not be decoded as an image.`;
  }
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024 * 10) / 10} MB` : `${Math.ceil(bytes / 1024)} KB`;
}
