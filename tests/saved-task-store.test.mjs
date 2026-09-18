import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { SavedTaskStore } = await import("../dsh-plugin/saved-task-store.ts");
const directory = await mkdtemp(join(tmpdir(), "dsh-saved-task-store-"));
const filePath = join(directory, "saved-tasks.json");

try {
  const store = new SavedTaskStore(filePath);
  assert.deepEqual(await store.load(), { initialized: false, tasks: [] });

  const tasks = [{ id: "task-1", name: "Review PR" }];
  await store.save(tasks);
  assert.deepEqual(await store.load(), { initialized: true, tasks });
  assert.match(await readFile(filePath, "utf8"), /"version":1/);
  await assert.rejects(() => store.save([undefined]), /invalid/);
} finally {
  await rm(directory, { recursive: true, force: true });
}

process.stdout.write("saved task store scenarios passed\n");
