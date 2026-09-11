import assert from "node:assert/strict";

const session = {};
const storage = {
  async get(key) { return { [key]: session[key] }; },
  async set(values) { Object.assign(session, values); },
  async remove(key) { delete session[key]; },
};

globalThis.chrome = { storage: { session: storage } };

const api = await import("../shared/attention.ts");
const question = {
  questionId: "question-1",
  chatId: "chat-1",
  question: "Which branch should I use?",
  options: ["main", "release"],
  allowFreeText: true,
};
const attention = {
  id: "user_question:question-1",
  sessionId: "session-1",
  chatId: "chat-1",
  tabId: 42,
  tabTitle: "GitHub",
  tabUrl: "https://github.com/example/repo",
  kind: "user_question",
  question,
};

assert.equal(api.isAttentionRequest(attention), true);
assert.equal(api.isAttentionRequest({ ...attention, question: { ...question, chatId: "other-chat" } }), false);

await api.saveAttentionRequest(attention);
assert.deepEqual(await api.loadAttentionRequests(), [attention]);
await api.setAttentionFocus("session-1");
assert.equal(await api.consumeAttentionFocus(), "session-1");
assert.equal(await api.consumeAttentionFocus(), undefined);
assert.deepEqual(await api.removeAttentionRequest(attention.id), attention);
assert.deepEqual(await api.loadAttentionRequests(), []);

process.stdout.write("attention storage scenarios passed\n");
