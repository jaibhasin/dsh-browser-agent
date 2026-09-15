import type { TaskDraftDefinition, TaskDraftParameter, TaskDraftQuestion } from "../shared/protocol.js";

type RecordValue = Record<string, unknown>;

const TASK_DRAFT_CORRECTION_PROMPT = [
  "Your previous response did not match the required task schema.",
  "Correct it and return only valid JSON, with no Markdown or explanation.",
  "Include every required field, use parameter type text/number/date/choice/boolean, use mode fixed/run/page, and use empty arrays when there are no warnings, parameters, or questions.",
  "JSON shape: {draft:{name,instructions,startingContext:{kind,url?},parameters:[{id,label,type,mode,value?,defaultValue?,required,options?}],constraints,expectedResult,warnings:[]},questions:[{id,question,options,allowFreeText,parameterId?}]}",
].join("\n\n");

export function parseTaskDraftText(raw: string, currentUrl?: string): { draft: TaskDraftDefinition; questions: TaskDraftQuestion[] } {
  const parsed = parseJson(raw);
  if (!isRecord(parsed)) throw new Error("The task builder returned an invalid draft.");

  const draftValue = parsed.draft ?? parsed;
  const draft = normalizeDraft(draftValue, currentUrl);
  const questions = normalizeQuestions(parsed.questions);
  if (!draft || questions === undefined) throw new Error("The task builder returned an invalid draft.");
  return { draft, questions };
}

export async function parseTaskDraftWithRetry(
  runTurn: (prompt: string) => Promise<string>,
  prompt: string,
  currentUrl?: string,
): Promise<{ draft: TaskDraftDefinition; questions: TaskDraftQuestion[] }> {
  try {
    return parseTaskDraftText(await runTurn(prompt), currentUrl);
  } catch {
    return parseTaskDraftText(await runTurn(TASK_DRAFT_CORRECTION_PROMPT), currentUrl);
  }
}

function parseJson(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("The task builder returned an invalid draft.");
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      throw new Error("The task builder returned an invalid draft.");
    }
  }
}

function normalizeDraft(value: unknown, currentUrl?: string): TaskDraftDefinition | undefined {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.instructions !== "string") return undefined;
  if (!value.name.trim() || !value.instructions.trim() || typeof value.constraints !== "string" || typeof value.expectedResult !== "string") return undefined;
  const context = normalizeStartingContext(value.startingContext, currentUrl);
  const parameters = normalizeParameters(value.parameters);
  if (!context || parameters === undefined) return undefined;
  const warnings = value.warnings === undefined ? [] : normalizeStringArray(value.warnings);
  if (warnings === undefined) return undefined;

  return {
    name: value.name,
    instructions: value.instructions,
    startingContext: context,
    parameters,
    constraints: value.constraints,
    expectedResult: value.expectedResult,
    warnings,
  };
}

function normalizeStartingContext(value: unknown, currentUrl?: string): TaskDraftDefinition["startingContext"] | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === "current-page" || value.kind === "current_page" || value.kind === "currentPage") return { kind: "current-page" };
  if (value.kind !== "url" && value.kind !== "saved-url" && value.kind !== "saved_url") return undefined;
  const url = typeof value.url === "string" && value.url.trim() ? value.url : currentUrl;
  return url ? { kind: "url", url } : undefined;
}

function normalizeParameters(value: unknown): TaskDraftParameter[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parameters: TaskDraftParameter[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.label !== "string" || !item.id.trim() || !item.label.trim()) return undefined;
    const type = normalizeParameterType(item.type);
    const mode = normalizeParameterMode(item.mode);
    if (!type || !mode) return undefined;
    const value = normalizeOptionalScalar(item, "value");
    const defaultValue = normalizeOptionalScalar(item, "defaultValue");
    const options = item.options === undefined ? undefined : normalizeScalarArray(item.options);
    if (!value.ok || !defaultValue.ok || (item.options !== undefined && options === undefined)) return undefined;
    parameters.push({
      id: item.id,
      label: item.label,
      type,
      mode,
      ...(value.value !== undefined ? { value: value.value } : {}),
      ...(defaultValue.value !== undefined ? { defaultValue: defaultValue.value } : {}),
      required: typeof item.required === "boolean" ? item.required : false,
      ...(options !== undefined ? { options } : {}),
    });
  }
  return parameters;
}

function normalizeQuestions(value: unknown): TaskDraftQuestion[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const questions: TaskDraftQuestion[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.question !== "string") return undefined;
    const options = normalizeStringArray(item.options);
    if (options === undefined && item.options !== undefined) return undefined;
    questions.push({
      id: item.id,
      question: item.question,
      options: options ?? [],
      allowFreeText: typeof item.allowFreeText === "boolean" ? item.allowFreeText : (options ?? []).length === 0,
      ...(typeof item.parameterId === "string" ? { parameterId: item.parameterId } : {}),
    });
  }
  return questions;
}

function normalizeParameterType(value: unknown): TaskDraftParameter["type"] | undefined {
  if (value === "text" || value === "number" || value === "date" || value === "choice" || value === "boolean") return value;
  if (value === "string") return "text";
  if (value === "integer" || value === "float") return "number";
  return undefined;
}

function normalizeParameterMode(value: unknown): TaskDraftParameter["mode"] | undefined {
  if (value === "fixed" || value === "run" || value === "page") return value;
  if (value === "runtime" || value === "runtime-input" || value === "input" || value === "variable") return "run";
  if (value === "page-derived" || value === "page_derived") return "page";
  return undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return undefined;
  return value;
}

function normalizeScalarArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value.map(normalizeScalar);
  return normalized.every((item): item is string => item !== undefined) ? normalized : undefined;
}

function normalizeOptionalScalar(record: RecordValue, key: string): { ok: true; value?: string } | { ok: false } {
  if (!(key in record) || record[key] === undefined) return { ok: true };
  const value = normalizeScalar(record[key]);
  return value === undefined ? { ok: false } : { ok: true, value };
}

function normalizeScalar(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return undefined;
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
