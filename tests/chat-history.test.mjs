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

const { loadChatHistory, saveChat } = await import("../extension/sidepanel/src/chat-history.ts");
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

process.stdout.write("chat history scenarios passed\n");
