import assert from "node:assert/strict";
import test from "node:test";
let lockQueue = Promise.resolve();
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { request(_name, operation) { const next = lockQueue.then(operation); lockQueue = next.catch(() => {}); return next; } } } });

const storage = new Map();
globalThis.chrome = {
  storage: {
    local: {
      async get(key) { return { [key]: storage.get(key) }; },
      async set(values) { for (const [key, value] of Object.entries(values)) storage.set(key, value); },
      async remove(key) { storage.delete(key); },
    },
  },
};

const { loadSavedTasks, saveSavedTask, loadTaskSetup, saveTaskSetup, buildTaskRunPrompt } = await import("../extension/sidepanel/src/saved-tasks.ts");

const legacy = {
  id: "legacy-task",
  version: 1,
  name: "Legacy task",
  instructions: "Read the page",
  startingContext: { kind: "current-page" },
  parameters: [],
  constraints: "",
  expectedResult: "A result",
  deniedTools: [],
  humanInTheLoop: false,
  createdAt: 1,
  updatedAt: 2,
};

test("migrates legacy saved tasks and persists the new revision field", async () => {
  storage.set("dshBrowserSavedTasksV1", { version: 1, tasks: [legacy] });
  const tasks = await loadSavedTasks();
  assert.equal(tasks[0].version, 2);
  assert.equal(tasks[0].revision, 1);
  assert.equal(storage.get("dshBrowserSavedTasksV1").version, 2);
});

test("serializes task writes and restores unfinished setup", async () => {
  storage.clear();
  await saveSavedTask({ ...legacy, version: 2, revision: 1 });
  const task = (await loadSavedTasks()).find((candidate) => candidate.id === legacy.id);
  assert.equal(task.revision, 1);
  const setup = { sourceSessionId: "session-1", conversation: "Review this", questions: [], answers: {}, updatedAt: 3 };
  await saveTaskSetup(setup);
  assert.deepEqual(await loadTaskSetup(), setup);
});

test("rejects stale edits across separate panel module instances", async () => {
  storage.clear();
  const task = { ...legacy, version: 2, revision: 1 };
  await saveSavedTask(task);
  const otherPanel = await import("../extension/sidepanel/src/saved-tasks.ts?panel=other");
  const results = await Promise.allSettled([
    saveSavedTask({ ...task, revision: 2, name: "First edit" }, 1),
    otherPanel.saveSavedTask({ ...task, revision: 2, name: "Stale edit" }, 1),
  ]);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await loadSavedTasks())[0].name, "First edit");
});

test("run prompts preserve parameter meanings and reject invalid values and URLs", () => {
  const task = { ...legacy, version: 2, revision: 1, parameters: [
    { id: "pr", label: "Pull request", type: "text", mode: "page", required: true },
    { id: "branch", label: "Target branch", type: "text", mode: "fixed", value: "main", required: true },
    { id: "limit", label: "Result limit", type: "number", mode: "run", required: true },
  ] };
  const prompt = buildTaskRunPrompt(task, { limit: "5" });
  assert.match(prompt, /Pull request \(pr\): Read from the live page/);
  assert.match(prompt, /Target branch \(branch\): "main"/);
  assert.match(prompt, /Result limit \(limit\): "5"/);
  assert.throws(() => buildTaskRunPrompt(task, { limit: "five" }), /number/);
  assert.throws(() => buildTaskRunPrompt(task, {}), /Please provide/);
  assert.throws(() => buildTaskRunPrompt({ ...task, startingContext: { kind: "url", url: "javascript:alert(1)" } }, { limit: "5" }), /HTTP/);
});
