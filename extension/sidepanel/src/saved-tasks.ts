import type { AgentToolName } from "../../../shared/protocol";

const STORAGE_KEY = "dshBrowserSavedTasksV1";
const DRAFT_STORAGE_KEY = "dshBrowserTaskSetupV1";
const MAX_TASKS = 100;

export type TaskValueType = "text" | "number" | "date" | "choice" | "boolean";
export type TaskParameter = {
  id: string;
  label: string;
  type: TaskValueType;
  mode: "fixed" | "run" | "page";
  value?: string;
  defaultValue?: string;
  required: boolean;
  options?: string[];
};

export type SavedTask = {
  id: string;
  version: 2;
  revision: number;
  name: string;
  instructions: string;
  startingContext: { kind: "current-page" | "url"; url?: string };
  parameters: TaskParameter[];
  constraints: string;
  expectedResult: string;
  deniedTools: AgentToolName[];
  humanInTheLoop: boolean;
  createdAt: number;
  updatedAt: number;
};
export type TaskSetupRecord = {
  sourceSessionId: string;
  conversation: string;
  draft?: Omit<SavedTask, "id" | "createdAt" | "updatedAt"> & { id?: string };
  questions: Array<{ id: string; question: string; options: string[]; allowFreeText: boolean; parameterId?: string }>;
  answers: Record<string, string>;
  updatedAt: number;
};

type StoredTasks = { version: 2; tasks: SavedTask[] };
let mutationQueue: Promise<void> = Promise.resolve();

function isTask(value: unknown): value is SavedTask {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const task = value as Partial<SavedTask>;
  return task.version === 2 && typeof task.revision === "number" && task.revision > 0 && typeof task.id === "string" && typeof task.name === "string" &&
    typeof task.instructions === "string" && typeof task.constraints === "string" && typeof task.expectedResult === "string" &&
    typeof task.createdAt === "number" && typeof task.updatedAt === "number" && Array.isArray(task.parameters) &&
    Array.isArray(task.deniedTools) && task.deniedTools.every((tool) => typeof tool === "string") && typeof task.humanInTheLoop === "boolean" &&
    !!task.startingContext && (task.startingContext.kind === "current-page" || task.startingContext.kind === "url") &&
    task.parameters.every((parameter) => parameter && typeof parameter.id === "string" && typeof parameter.label === "string" &&
      ["text", "number", "date", "choice", "boolean"].includes(parameter.type as string) &&
      ["fixed", "run", "page"].includes(parameter.mode as string) && typeof parameter.required === "boolean");
}

export async function loadSavedTasks(): Promise<SavedTask[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const data = stored[STORAGE_KEY] as Partial<StoredTasks> | undefined;
  if (!Array.isArray(data?.tasks)) return [];
  const migrated = data.tasks.map((task) => migrateTask(task)).filter((task): task is SavedTask => task !== undefined);
  if (data.version !== 2) await chrome.storage.local.set({ [STORAGE_KEY]: { version: 2, tasks: migrated } satisfies StoredTasks });
  return migrated.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveSavedTask(task: SavedTask, expectedRevision = 0): Promise<void> {
  return enqueue(async () => {
    const tasks = await loadSavedTasks();
    const existing = tasks.find((candidate) => candidate.id === task.id);
    if ((existing?.revision ?? 0) !== expectedRevision || task.revision !== expectedRevision + 1) {
      throw new Error("This task changed in another panel. Reload it before saving.");
    }
    validateTask(task);
    if (!existing && tasks.length >= MAX_TASKS) throw new Error("Saved task limit reached. Delete a task before adding another.");
    const next = [task, ...tasks.filter((candidate) => candidate.id !== task.id)]
      .sort((a, b) => b.updatedAt - a.updatedAt);
    await chrome.storage.local.set({ [STORAGE_KEY]: { version: 2, tasks: next } satisfies StoredTasks });
  });
}

export function removeSavedTask(id: string): Promise<void> {
  return enqueue(async () => {
    const tasks = (await loadSavedTasks()).filter((task) => task.id !== id);
    await chrome.storage.local.set({ [STORAGE_KEY]: { version: 2, tasks } satisfies StoredTasks });
  });
}

export async function loadTaskSetup(): Promise<TaskSetupRecord | undefined> {
  const stored = await chrome.storage.local.get(DRAFT_STORAGE_KEY);
  const record = stored[DRAFT_STORAGE_KEY] as Partial<TaskSetupRecord> | undefined;
  if (!record || typeof record.sourceSessionId !== "string" || typeof record.conversation !== "string" || !Array.isArray(record.questions) || !record.answers || typeof record.answers !== "object") return undefined;
  return record as TaskSetupRecord;
}

export function saveTaskSetup(record: TaskSetupRecord): Promise<void> {
  return chrome.storage.local.set({ [DRAFT_STORAGE_KEY]: record });
}

export function removeTaskSetup(): Promise<void> {
  return chrome.storage.local.remove(DRAFT_STORAGE_KEY);
}

function migrateTask(value: unknown): SavedTask | undefined {
  if (isTask(value)) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const legacy = value as Partial<SavedTask> & { version?: unknown };
  if ((legacy as { version?: unknown }).version !== 1 || typeof legacy.id !== "string" || typeof legacy.name !== "string" || typeof legacy.instructions !== "string" ||
      typeof legacy.constraints !== "string" || typeof legacy.expectedResult !== "string" || typeof legacy.createdAt !== "number" || typeof legacy.updatedAt !== "number" ||
      !Array.isArray(legacy.parameters) || !Array.isArray(legacy.deniedTools) || typeof legacy.humanInTheLoop !== "boolean" || !legacy.startingContext) return undefined;
  return { ...legacy, version: 2, revision: 1 } as SavedTask;
}

function enqueue(operation: () => Promise<void>): Promise<void> {
  const locked = async (): Promise<void> => { await navigator.locks.request("dsh-saved-tasks", operation); };
  const next = mutationQueue.then(locked, locked);
  mutationQueue = next.catch(() => undefined);
  return next;
}

export function validateParameterValue(parameter: TaskParameter, value: string): void {
  if (!value.trim()) {
    if (parameter.required) throw new Error(`Please provide: ${parameter.label}.`);
    return;
  }
  if (parameter.type === "number" && !Number.isFinite(Number(value))) throw new Error(`${parameter.label} must be a number.`);
  if (parameter.type === "boolean" && !["true", "false"].includes(value)) throw new Error(`${parameter.label} must be true or false.`);
  if (parameter.type === "choice" && !parameter.options?.includes(value)) throw new Error(`Choose a valid option for ${parameter.label}.`);
  if (parameter.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new Error(`${parameter.label} must be a valid date.`);
}

export function validateTask(task: SavedTask): void {
  if (!isTask(task) || !task.name.trim() || !task.instructions.trim()) throw new Error("Task definition is invalid.");
  if (task.startingContext.kind === "url") {
    const url = new URL(task.startingContext.url ?? "");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Use an HTTP or HTTPS starting URL without credentials.");
  }
  const ids = new Set<string>();
  for (const parameter of task.parameters) {
    if (!parameter.id.trim() || ids.has(parameter.id) || !parameter.label.trim()) throw new Error("Inputs need unique IDs and nonempty labels.");
    ids.add(parameter.id);
    if (parameter.type === "choice" && (!parameter.options?.length || parameter.options.some((option) => typeof option !== "string" || !option.trim()))) throw new Error(`${parameter.label} needs choices.`);
    if (parameter.mode === "fixed") validateParameterValue(parameter, parameter.value ?? "");
    if (parameter.mode === "run" && parameter.defaultValue) validateParameterValue(parameter, parameter.defaultValue);
  }
}

export function buildTaskRunPrompt(task: SavedTask, values: Record<string, string>): string {
  validateTask(task);
  const inputs = task.parameters.map((parameter) => {
    if (parameter.mode === "page") return `${parameter.label} (${parameter.id}): Read from the live page on this run. Ask the user if ambiguous or unavailable.`;
    const value = parameter.mode === "fixed" ? parameter.value ?? "" : values[parameter.id] ?? parameter.defaultValue ?? "";
    validateParameterValue(parameter, value);
    return `${parameter.label} (${parameter.id}): ${JSON.stringify(value)}`;
  });
  return [task.instructions, task.startingContext.kind === "url" ? `Open the saved starting URL: ${task.startingContext.url}` : "Use the page currently open in the browser.", `Run inputs:\n${inputs.join("\n") || "(none)"}`, `Constraints:\n${task.constraints}`, `Expected result:\n${task.expectedResult}`].join("\n\n");
}
