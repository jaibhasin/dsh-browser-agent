import type { TaskDraftDefinition, TaskDraftParameter, TaskDraftQuestion } from "../shared/protocol.js";

type RecordValue = Record<string, unknown>;

export function parseTaskDraftText(raw: string, currentUrl?: string): { draft: TaskDraftDefinition; questions: TaskDraftQuestion[] } {
  const parsed = parseJson(raw);
  if (!isRecord(parsed)) throw new Error("The task builder returned an invalid draft.");

  const draftValue = parsed.draft ?? parsed;
  const draft = normalizeDraft(draftValue, currentUrl);
  const questions = normalizeQuestions(parsed.questions);
  if (!draft || questions === undefined) throw new Error("The task builder returned an invalid draft.");
  return { draft, questions };
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
  const context = normalizeStartingContext(value.startingContext, currentUrl);
  const parameters = normalizeParameters(value.parameters);
  if (!context || parameters === undefined) return undefined;

  return {
    name: value.name,
    instructions: value.instructions,
    startingContext: context,
    parameters,
    constraints: typeof value.constraints === "string" ? value.constraints : "",
    expectedResult: typeof value.expectedResult === "string" ? value.expectedResult : "",
    warnings: normalizeStringArray(value.warnings) ?? [],
  };
}

function normalizeStartingContext(value: unknown, currentUrl?: string): TaskDraftDefinition["startingContext"] | undefined {
  if (!isRecord(value)) return { kind: "current-page" };
  if (value.kind === "current-page" || value.kind === "current_page" || value.kind === "currentPage") return { kind: "current-page" };
  if (value.kind !== "url" && value.kind !== "saved-url" && value.kind !== "saved_url") return undefined;
  const url = typeof value.url === "string" && value.url.trim() ? value.url : currentUrl;
  return url ? { kind: "url", url } : undefined;
}

function normalizeParameters(value: unknown): TaskDraftParameter[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const parameters: TaskDraftParameter[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.label !== "string") return undefined;
    const type = normalizeParameterType(item.type);
    const mode = normalizeParameterMode(item.mode);
    if (!type || !mode) return undefined;
    parameters.push({
      id: item.id,
      label: item.label,
      type,
      mode,
      ...(typeof item.value === "string" ? { value: item.value } : {}),
      ...(typeof item.defaultValue === "string" ? { defaultValue: item.defaultValue } : {}),
      required: typeof item.required === "boolean" ? item.required : false,
      ...(normalizeStringArray(item.options) ? { options: normalizeStringArray(item.options) } : {}),
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

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
