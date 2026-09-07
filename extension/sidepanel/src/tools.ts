import { BROWSER_TOOL_DEFS, type BrowserToolName } from "../../../shared/protocol";

const STORAGE_KEY = "dshBrowserToolsV1";

/**
 * Persisted per-chat tool permissions.
 *
 * - `deniedDefault` is the template copied into newly created chats.
 * - `deniedByChat` holds the independent disabled tools for each chat session.
 */
export type StoredTools = {
  version: 3;
  deniedDefault: BrowserToolName[];
  deniedByChat: Record<string, BrowserToolName[]>;
};

const VALID_TOOL_NAMES = new Set<string>(BROWSER_TOOL_DEFS.map((tool) => tool.name));

// Storage is shared by every mounted side panel in a Chrome profile; serialize
// local mutations so an older async read cannot overwrite a newer save.
let mutationQueue: Promise<void> = Promise.resolve();

export { BROWSER_TOOL_DEFS };
export type { BrowserToolName };

export async function loadToolSettings(): Promise<StoredTools> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const tools = stored[STORAGE_KEY] as Partial<StoredTools> | undefined;
  if (tools?.version !== 3) {
    // Preserve the old default as the template for future chats, but never
    // apply it directly to an existing chat without a saved snapshot.
    return {
      version: 3,
      deniedDefault: sanitize(tools?.deniedDefault),
      deniedByChat: sanitizeByChat(tools?.deniedByChat),
    };
  }
  return {
    version: 3,
    deniedDefault: sanitize(tools.deniedDefault),
    deniedByChat: sanitizeByChat(tools.deniedByChat),
  };
}

export function saveToolSettings(settings: StoredTools): Promise<void> {
  return enqueueMutation(async () => {
    await chrome.storage.local.set({ [STORAGE_KEY]: settings satisfies StoredTools });
  });
}

/**
 * The disabled-tool list that actually applies to a session: its own override
 * if it has one, otherwise the global default.
 */
export function effectiveDenied(settings: StoredTools, sessionId: string): BrowserToolName[] {
  return settings.deniedByChat[sessionId] ?? settings.deniedDefault;
}

// Keep only names that still correspond to a registered browser tool, so a
// stale set (e.g. after a tool was renamed) can never crash the plugin's
// tool-restriction call.
function sanitize(value: unknown): BrowserToolName[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((name): name is BrowserToolName => typeof name === "string" && VALID_TOOL_NAMES.has(name))
    .sort();
}

function sanitizeByChat(value: unknown): Record<string, BrowserToolName[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, BrowserToolName[]> = {};
  for (const [sessionId, tools] of Object.entries(value as Record<string, unknown>)) {
    const sanitized = sanitize(tools);
    if (sanitized.length > 0) out[sessionId] = sanitized;
  }
  return out;
}

function enqueueMutation(mutation: () => Promise<void>): Promise<void> {
  const next = mutationQueue.then(mutation, mutation);
  mutationQueue = next.catch(() => undefined);
  return next;
}
