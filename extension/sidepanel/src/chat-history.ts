const STORAGE_KEY = "dshBrowserChatHistoryV1";
const MAX_SESSIONS = 100;

export type ChatMessage = { kind: "message"; id: string; role: "assistant" | "user"; text: string };
export type ToolActivity = { callId: string; tool: string; input?: string; output?: string; status: "running" | "success" | "error"; error?: string };
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
};

type StoredHistory = { version: 1; chats: SavedChat[] };

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
    Array.isArray(chat.items) && Array.isArray(chat.links) && chat.links.every((link) => typeof link === "string");
}

export async function loadChatHistory(): Promise<SavedChat[]> {
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
    await chrome.storage.local.set({ [STORAGE_KEY]: { version: 1, chats: next } satisfies StoredHistory });
  });
}

export function removeChat(id: string): Promise<void> {
  deletedChatIds.add(id);
  return enqueueMutation(async () => {
    const chats = (await loadChatHistory()).filter((chat) => chat.id !== id);
    await chrome.storage.local.set({ [STORAGE_KEY]: { version: 1, chats } satisfies StoredHistory });
  });
}

function enqueueMutation(mutation: () => Promise<void>): Promise<void> {
  const next = mutationQueue.then(mutation, mutation);
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
