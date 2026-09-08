/** The wire format shared by the Chrome extension and local DSH plugin. */
export const PROTOCOL_VERSION = 1;

/**
 * The browser tools the plugin registers, with friendly names the side panel
 * renders in its enable/disable menu. The `name` values MUST match the tools
 * registered in dsh-plugin/tools/browser-snapshot.ts, because the plugin
 * filters out any unknown name before applying a per-agent restriction.
 */
export const BROWSER_TOOL_DEFS = [
  { name: "browser_navigate", label: "Navigate", description: "Open a URL in the agent tab." },
  { name: "browser_tabs", label: "Tabs", description: "List the open browser tabs." },
  { name: "browser_snapshot", label: "Snapshot", description: "Read the page as DOM and accessibility text." },
  { name: "browser_wait", label: "Wait", description: "Wait for the page to settle, then resnapshot." },
  { name: "browser_screenshot", label: "Screenshot", description: "Capture a PNG of the viewport." },
  { name: "browser_scroll", label: "Scroll", description: "Scroll the active tab by pixels." },
  { name: "browser_click", label: "Click", description: "Click a visible element by ref." },
  { name: "browser_type", label: "Type", description: "Fill a visible input by ref." },
] as const;

export type BrowserToolName = (typeof BROWSER_TOOL_DEFS)[number]["name"];

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export const IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];
export const DOCUMENT_EXTENSIONS = [
  "doc", "docx", "docm", "pdf", "csv", "xls", "xlsx", "xlsm", "xlsb",
  "ppt", "pps", "pot", "pptx", "pptm", "ppsx", "ppsm", "odt", "ods", "odp", "rtf", "epub", "md", "txt",
] as const;
export type DocumentExtension = (typeof DOCUMENT_EXTENSIONS)[number];
export const DOCUMENT_LIMITS = {
  maxFilesPerMessage: 4,
  maxFileBytes: 10 * 1024 * 1024,
  maxMessageBytes: 20 * 1024 * 1024,
  maxNameLength: 255,
  maxMarkdownChars: 200_000,
} as const;
export function documentExtension(name: string): DocumentExtension | undefined {
  const extension = name.trim().toLowerCase().split(".").pop();
  return (DOCUMENT_EXTENSIONS as readonly string[]).includes(extension ?? "") ? extension as DocumentExtension : undefined;
}
export function isSupportedDocumentName(name: string): boolean {
  return documentExtension(name) !== undefined;
}
export type BridgePromptContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: ImageMediaType; data: string; name?: string }
  | { type: "document"; name: string; mediaType?: string; data: string };
export type BridgeHello = { type: "hello"; protocolVersion: typeof PROTOCOL_VERSION; token: string; client: "chrome-extension" };
export type BridgeWelcome = { type: "welcome"; protocolVersion: typeof PROTOCOL_VERSION };
export type BridgeRequest = { type: "request"; id: string; method: string; params: JsonValue; taskId?: string };
export type BridgeResponse = { type: "response"; id: string; result?: JsonValue; error?: { code: string; message: string } };
export type BridgeEvent = { type: "event"; event: string; payload: JsonValue };
export type BridgePing = { type: "ping" };
export type BridgePong = { type: "pong" };
export type BridgeChat = { type: "chat"; id: string; text: string; sessionId: string; resume: boolean; content?: BridgePromptContentPart[]; deniedTools?: string[]; humanInTheLoop?: boolean };
export type BridgeChatResponse = { type: "chat_response"; id: string; text?: string; error?: { code: string; message: string } };
export type BridgeChatDelta = { type: "chat_delta"; id: string; text: string };
export type BridgeNewSession = { type: "new_session"; id: string };
export type BridgeNewSessionResponse = { type: "new_session_response"; id: string; error?: { code: string; message: string } };
export type BridgeChatProgress = {
  type: "chat_progress";
  id: string;
  phase: "tool_started" | "tool_finished" | "tool_failed";
  callId: string;
  tool: string;
  detail?: string;
  output?: string;
  error?: string;
};
export type BridgeMessage = BridgeHello | BridgeWelcome | BridgeRequest | BridgeResponse | BridgeEvent | BridgePing | BridgePong | BridgeChat | BridgeChatResponse | BridgeChatDelta | BridgeNewSession | BridgeNewSessionResponse | BridgeChatProgress;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

/** Parses only messages supported by the current protocol version. */
export function parseBridgeMessage(value: unknown): BridgeMessage | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;
  switch (value.type) {
    case "hello":
      return value.protocolVersion === PROTOCOL_VERSION && typeof value.token === "string" && value.client === "chrome-extension" ? value as BridgeHello : undefined;
    case "welcome":
      return value.protocolVersion === PROTOCOL_VERSION ? value as BridgeWelcome : undefined;
    case "request":
      return typeof value.id === "string" && typeof value.method === "string" && isJsonValue(value.params) && (value.taskId === undefined || typeof value.taskId === "string") ? value as BridgeRequest : undefined;
    case "response":
      return typeof value.id === "string" && (value.result === undefined || isJsonValue(value.result)) && (value.error === undefined || (isRecord(value.error) && typeof value.error.code === "string" && typeof value.error.message === "string")) ? value as BridgeResponse : undefined;
    case "chat":
      return typeof value.id === "string" && typeof value.text === "string" && typeof value.sessionId === "string" && typeof value.resume === "boolean" &&
        (value.content === undefined || (Array.isArray(value.content) && value.content.length > 0 && value.content.every(isPromptContentPart))) &&
        (value.deniedTools === undefined || (Array.isArray(value.deniedTools) && value.deniedTools.every((tool) => typeof tool === "string"))) &&
        (value.humanInTheLoop === undefined || typeof value.humanInTheLoop === "boolean") ? value as BridgeChat : undefined;
    case "chat_response":
      return typeof value.id === "string" && (value.text === undefined || typeof value.text === "string") && (value.error === undefined || (isRecord(value.error) && typeof value.error.code === "string" && typeof value.error.message === "string")) ? value as BridgeChatResponse : undefined;
    case "chat_delta":
      return typeof value.id === "string" && typeof value.text === "string" ? value as BridgeChatDelta : undefined;
    case "new_session":
      return typeof value.id === "string" ? value as BridgeNewSession : undefined;
    case "new_session_response":
      return typeof value.id === "string" && (value.error === undefined || (isRecord(value.error) && typeof value.error.code === "string" && typeof value.error.message === "string")) ? value as BridgeNewSessionResponse : undefined;
    case "chat_progress":
      return typeof value.id === "string" &&
        typeof value.callId === "string" &&
        typeof value.tool === "string" &&
        (value.phase === "tool_started" || value.phase === "tool_finished" || value.phase === "tool_failed") &&
        (value.detail === undefined || typeof value.detail === "string") &&
        (value.output === undefined || typeof value.output === "string") &&
        (value.error === undefined || typeof value.error === "string")
        ? value as BridgeChatProgress
        : undefined;
    case "event":
      return typeof value.event === "string" && isJsonValue(value.payload) ? value as BridgeEvent : undefined;
    case "ping":
    case "pong":
      return value as BridgePing | BridgePong;
    default:
      return undefined;
  }
}

function isPromptContentPart(value: unknown): value is BridgePromptContentPart {
  if (!isRecord(value) || (value.type !== "text" && value.type !== "image" && value.type !== "document")) return false;
  if (value.type === "text") return typeof value.text === "string";
  if (value.type === "image") {
    return typeof value.mediaType === "string" &&
      (IMAGE_MEDIA_TYPES as readonly string[]).includes(value.mediaType) &&
      typeof value.data === "string" &&
      (value.name === undefined || typeof value.name === "string");
  }
  return typeof value.name === "string" && value.name.length > 0 && value.name.length <= DOCUMENT_LIMITS.maxNameLength &&
    typeof value.data === "string" && isBase64(value.data) &&
    (value.mediaType === undefined || typeof value.mediaType === "string");
}

function isBase64(value: string): boolean {
  return value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}
