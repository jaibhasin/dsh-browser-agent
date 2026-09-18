import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const STORE_VERSION = 1;
const MAX_TASKS = 100;
const MAX_STORE_BYTES = 10 * 1024 * 1024;

type StoredTasks = { version: typeof STORE_VERSION; tasks: unknown[] };

export type SavedTaskStoreResult = { initialized: boolean; tasks: unknown[] };

export function defaultSavedTaskStorePath(): string {
  // DSH owns this file, allowing every Chrome profile using this DSH instance to share tasks.
  const dshHome = process.env.DSH_HOME || join(homedir(), ".dsh");
  return join(dshHome, "dsh-browser-agent-saved-tasks.json");
}

export function defaultSavedChatStorePath(): string {
  const dshHome = process.env.DSH_HOME || join(homedir(), ".dsh");
  return join(dshHome, "dsh-browser-agent-saved-chats.json");
}

export class SavedTaskStore {
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly filePath: string;

  constructor(filePath = defaultSavedTaskStorePath()) {
    this.filePath = filePath;
  }

  async load(): Promise<SavedTaskStoreResult> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { initialized: false, tasks: [] };
      throw error;
    }
    const parsed = JSON.parse(raw) as Partial<StoredTasks>;
    if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.tasks)) throw new Error("The saved task store is invalid.");
    return { initialized: true, tasks: parsed.tasks };
  }

  save(tasks: unknown[]): Promise<void> {
    return this.enqueue(async () => {
      if (tasks.length > MAX_TASKS || !tasks.every(isJsonValue)) throw new Error("The saved task store is invalid.");
      const content = JSON.stringify({ version: STORE_VERSION, tasks } satisfies StoredTasks);
      if (Buffer.byteLength(content, "utf8") > MAX_STORE_BYTES) throw new Error("The saved task store is too large.");
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
      const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${content}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    });
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.mutationQueue.then(operation, operation);
    this.mutationQueue = next.catch(() => undefined);
    return next;
  }
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!value || typeof value !== "object") return false;
  return Object.values(value).every(isJsonValue);
}
