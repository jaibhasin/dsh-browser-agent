import type { DocumentExtension, ImageMediaType } from "../../../shared/protocol";

const STORAGE_KEY = "dshBrowserChatHistoryV1";
const MAX_SESSIONS = 100;

export type ChatImage = { id: string; mediaType: ImageMediaType; bytes: number; width: number; height: number; name?: string };
export type ChatDocument = { id: string; name: string; extension: DocumentExtension; bytes: number };
export type ChatMessage = { kind: "message"; id: string; role: "assistant" | "user"; text: string; images?: ChatImage[]; documents?: ChatDocument[] };

/**
 * One tool call the agent made while working on a chat.
 *
 * Timing fields (both optional so older saved chats still load fine):
 * - `startedAt`  – epoch ms captured the moment the "tool_started" progress
 *                  event arrives in the side panel.
 * - `durationMs` – how long the call took, frozen in when the matching
 *                  "tool_finished"/"tool_failed" event arrives.
 * Together they let the activity spine show a quiet "1.2s" per step.
 */
export type ToolActivity = { callId: string; tool: string; input?: string; output?: string; status: "running" | "success" | "error"; error?: string; startedAt?: number; durationMs?: number };
export type ActivityGroup = { kind: "activity"; id: string; steps: ToolActivity[] };
export type ConversationItem = ChatMessage | ActivityGroup;

export type SavedChat = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  status: "active" | "paused" | "completed" | "interrupted";
  items: ConversationItem[];
  links: string[];
  taskRun?: {
    taskId: string;
    taskRevision: number;
    taskSnapshot: unknown;
    inputValues: Record<string, string>;
    target: { kind: "tab" | "url"; url?: string };
    startedAt: number;
  };
};

type StoredHistory = { version: 1; chats: SavedChat[] };
type SharedHistoryResponse = { initialized: boolean; chats: unknown[] };

// Storage is shared by every mounted side panel in a Chrome profile.
// Serialize local mutations so an older async read cannot overwrite a newer save
// or resurrect a chat that has just been deleted.
let mutationQueue: Promise<void> = Promise.resolve();
const deletedChatIds = new Set<string>();

function isSavedChat(value: unknown): value is SavedChat {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const chat = value as Partial<SavedChat>;
  return typeof chat.id === "string" && typeof chat.title === "string" &&
    typeof chat.createdAt === "number" && typeof chat.updatedAt === "number" &&
    (chat.status === "active" || chat.status === "paused" || chat.status === "completed" || chat.status === "interrupted") &&
    Array.isArray(chat.items) && Array.isArray(chat.links) && chat.links.every((link) => typeof link === "string") &&
    (chat.taskRun === undefined || (typeof chat.taskRun === "object" && chat.taskRun !== null && typeof chat.taskRun.taskId === "string" && typeof chat.taskRun.taskRevision === "number" &&
      typeof chat.taskRun.startedAt === "number" && typeof chat.taskRun.inputValues === "object" && chat.taskRun.inputValues !== null &&
      typeof chat.taskRun.target === "object" && chat.taskRun.target !== null && (chat.taskRun.target.kind === "tab" || chat.taskRun.target.kind === "url")));
}

export async function loadChatHistory(): Promise<SavedChat[]> {
  const local = await loadLocalChatHistory();
  const shared = await loadSharedChatHistory();
  if (!shared) return local;
  if (!shared.initialized) {
    if (local.length > 0) await saveSharedChatHistory(local);
    return local;
  }
  const chats = shared.chats.filter(isSavedChat).sort((a, b) => b.updatedAt - a.updatedAt);
  await saveLocalChatHistory(chats);
  return chats;
}

async function loadLocalChatHistory(): Promise<SavedChat[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const history = stored[STORAGE_KEY] as Partial<StoredHistory> | undefined;
  if (history?.version !== 1 || !Array.isArray(history.chats)) return [];
  return history.chats.filter(isSavedChat).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveChat(chat: SavedChat): Promise<void> {
  return enqueueMutation(async () => {
    if (deletedChatIds.has(chat.id)) return;
    const chats = await loadChatHistory();
    const existing = chats.find((candidate) => candidate.id === chat.id);
    // A delayed render should never replace a newer persisted snapshot.
    if (existing && existing.updatedAt > chat.updatedAt) return;
    const next = [chat, ...chats.filter((candidate) => candidate.id !== chat.id)]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SESSIONS);
    await persistChatHistory(next);
  });
}

export function removeChat(id: string): Promise<void> {
  deletedChatIds.add(id);
  return enqueueMutation(async () => {
    const chats = (await loadChatHistory()).filter((chat) => chat.id !== id);
    await persistChatHistory(chats);
  });
}

async function saveLocalChatHistory(chats: SavedChat[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: { version: 1, chats } satisfies StoredHistory });
}

async function loadSharedChatHistory(): Promise<SharedHistoryResponse | undefined> {
  if (!globalThis.chrome?.runtime?.sendMessage) return undefined;
  try {
    const response = await chrome.runtime.sendMessage({ type: "dsh-saved-chats-load" }) as { ok?: boolean; initialized?: unknown; chats?: unknown } | undefined;
    if (response?.ok !== true || typeof response.initialized !== "boolean" || !Array.isArray(response.chats)) return undefined;
    return { initialized: response.initialized, chats: response.chats };
  } catch {
    return undefined;
  }
}

async function saveSharedChatHistory(chats: SavedChat[]): Promise<boolean> {
  if (!globalThis.chrome?.runtime?.sendMessage) return false;
  try {
    const response = await chrome.runtime.sendMessage({ type: "dsh-saved-chats-save", chats }) as { ok?: boolean } | undefined;
    return response?.ok === true;
  } catch {
    return false;
  }
}

async function persistChatHistory(chats: SavedChat[]): Promise<void> {
  await saveLocalChatHistory(chats);
  await saveSharedChatHistory(chats);
}

function enqueueMutation(mutation: () => Promise<void>): Promise<void> {
  // The worker and side panels can save concurrently during a benchmark.
  const lockedMutation = async (): Promise<void> => {
    if (globalThis.navigator?.locks) await navigator.locks.request("dsh-browser-chat-history", mutation);
    else await mutation();
  };
  const next = mutationQueue.then(lockedMutation, lockedMutation);
  mutationQueue = next.catch(() => undefined);
  return next;
}

export function chatTitle(items: ConversationItem[]): string {
  const firstUserMessage = items.find((item): item is ChatMessage => item.kind === "message" && item.role === "user");
  if (!firstUserMessage) return "New chat";
  return firstUserMessage.text.replace(/\s+/g, " ").trim().slice(0, 56) || "New chat";
}

export function collectHttpLinks(existing: string[], url?: string): string[] {
  if (!url) return existing;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return existing;
    return [parsed.href, ...existing.filter((link) => link !== parsed.href)].slice(0, 20);
  } catch {
    return existing;
  }
}
