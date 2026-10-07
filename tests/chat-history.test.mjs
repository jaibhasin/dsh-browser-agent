import assert from "node:assert/strict";
import test from "node:test";

const local = new Map();
let shared;
globalThis.chrome = {
  storage: {
    local: {
      async get(key) { return { [key]: local.get(key) }; },
      async set(values) { for (const [key, value] of Object.entries(values)) local.set(key, value); },
    },
  },
  runtime: {
    async sendMessage(message) {
      if (message.type === "dsh-saved-chats-load") return shared ? { ok: true, ...shared } : undefined;
      if (message.type === "dsh-saved-chats-save") { shared = { initialized: true, chats: message.chats }; return { ok: true }; }
      return undefined;
    },
  },
};

const { loadChatHistory, saveChat, removeChat } = await import("../extension/sidepanel/src/chat-history.ts");
const chat = {
  id: "chat-1",
  title: "Review PR",
  createdAt: 1,
  updatedAt: 2,
  status: "completed",
  items: [{ kind: "message", id: "message-1", role: "user", text: "Review this PR" }],
  links: ["https://github.com/example/repo"],
};

test("hydrates chat history from the shared DSH store after a profile-local cache is cleared", async () => {
  shared = { initialized: false, chats: [] };
  await saveChat(chat);
  local.clear();
  assert.deepEqual(await loadChatHistory(), [chat]);
  assert.equal(local.get("dshBrowserChatHistoryV1").chats[0].id, "chat-1");
});

test("history refreshes cannot restore a deleted chat while older saves are queued", async () => {
  const queuedChat = { ...chat, id: "queued-chat" };
  await saveChat(queuedChat);
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const sendMessage = chrome.runtime.sendMessage;
  const set = chrome.storage.local.set;
  const writes = [];
  chrome.runtime.sendMessage = async (message) => {
    if (message.type === "dsh-saved-chats-load") await blocked;
    return sendMessage(message);
  };
  chrome.storage.local.set = async (values) => {
    writes.push(values.dshBrowserChatHistoryV1?.chats ?? []);
    return set(values);
  };
  try {
    const saving = saveChat({ ...queuedChat, updatedAt: 3 });
    await new Promise((resolve) => setImmediate(resolve));
    const deleting = removeChat(queuedChat.id);
    const refreshing = loadChatHistory();
    release();
    const history = await refreshing;
    await Promise.all([saving, deleting]);
    assert.ok(!history.some((chat) => chat.id === queuedChat.id));
    assert.ok(writes.every((chats) => !chats.some((chat) => chat.id === queuedChat.id)));
    assert.ok(!(await loadChatHistory()).some((chat) => chat.id === queuedChat.id));
  } finally {
    release();
    chrome.runtime.sendMessage = sendMessage;
    chrome.storage.local.set = set;
  }
});

process.stdout.write("chat history scenarios passed\n");
