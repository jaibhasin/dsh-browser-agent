import type * as React from "react";
import type { SavedTask, TaskParameter } from "../saved-tasks";
import type { TaskDraftQuestion } from "../../../../shared/protocol";

export type TaskDraft = Omit<SavedTask, "id" | "createdAt" | "updatedAt"> & { id?: string };

type Props = {
  notice: string;
  draft: TaskDraft | undefined;
  setDraft: React.Dispatch<React.SetStateAction<TaskDraft | undefined>>;
  saveTask: () => Promise<void>;
  close: () => void;
  runningTask: SavedTask | undefined;
  setRunningTask: React.Dispatch<React.SetStateAction<SavedTask | undefined>>;
  runTaskWithInputs: (task: SavedTask, values: Record<string, string>) => Promise<void>;
  questions: TaskDraftQuestion[];
  answers: Record<string, string>;
  setAnswers: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  continueSetup: () => Promise<void>;
  setupBusy: boolean;
};

export function TaskDialogs({ notice, draft, setDraft, saveTask, close, runningTask, setRunningTask, runTaskWithInputs, questions, answers, setAnswers, continueSetup, setupBusy }: Props) {
  return <>
    {draft && <div className="delete-modal-backdrop" role="presentation"><section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="task-draft-title">
      <span className="delete-modal-eyebrow">Save as a task</span><h2 id="task-draft-title">Review reusable task</h2>
      {notice && <p role="status">{notice}</p>}<p className="task-help">Confirm what stays fixed and what should be supplied or read from the page on every run.</p>
      {questions.length > 0 && <fieldset><legend>Clarify the reusable parts</legend>{questions.map((question) => <label key={question.id}>{question.question}{question.options.length > 0 && <select value={answers[question.id] ?? ""} onChange={(e) => setAnswers((current) => ({ ...current, [question.id]: e.target.value }))}><option value="">Choose an answer</option>{question.options.map((option) => <option key={option} value={option}>{option}</option>)}</select>}{question.allowFreeText && <input value={answers[question.id] ?? ""} onChange={(e) => setAnswers((current) => ({ ...current, [question.id]: e.target.value }))} placeholder="Your answer" />}</label>)}</fieldset>}
      <label>Name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      <label>Instructions<textarea value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} rows={4} /></label>
      <label>Starting context<select value={draft.startingContext.kind} onChange={(e) => setDraft({ ...draft, startingContext: e.target.value === "url" ? { kind: "url", url: draft.startingContext.url } : { kind: "current-page" } })}><option value="current-page">Current page when run</option><option value="url">Saved URL</option></select></label>
      {draft.startingContext.kind === "url" && <label>URL<input value={draft.startingContext.url ?? ""} onChange={(e) => setDraft({ ...draft, startingContext: { kind: "url", url: e.target.value } })} /></label>}
      <label>Constraints<textarea value={draft.constraints} onChange={(e) => setDraft({ ...draft, constraints: e.target.value })} rows={2} /></label>
      <label>Expected result<textarea value={draft.expectedResult} onChange={(e) => setDraft({ ...draft, expectedResult: e.target.value })} rows={2} /></label>
      <fieldset><legend>Run inputs</legend>{draft.parameters.map((parameter, index) => <ParameterEditor key={parameter.id} parameter={parameter} onChange={(next) => setDraft({ ...draft, parameters: draft.parameters.map((item, itemIndex) => itemIndex === index ? next : item) })} onRemove={() => setDraft({ ...draft, parameters: draft.parameters.filter((_, itemIndex) => itemIndex !== index) })} />)}<button type="button" onClick={() => setDraft({ ...draft, parameters: [...draft.parameters, { id: `input-${crypto.randomUUID()}`, label: "New input", type: "text", mode: "run", required: false }] })}>Add input</button></fieldset>
      <div className="delete-modal-actions"><button type="button" onClick={close}>Cancel</button>{questions.length > 0 ? <button className="delete-modal-primary" type="button" onClick={() => void continueSetup()} disabled={setupBusy}>{setupBusy ? "Thinking..." : "Continue"}</button> : <button className="delete-modal-primary" type="button" onClick={() => void saveTask()} disabled={setupBusy || !draft.name.trim() || !draft.instructions.trim()}>{setupBusy ? "Saving..." : "Save task"}</button>}</div>
    </section></div>}
    {runningTask && <div className="delete-modal-backdrop" role="presentation"><section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="run-task-title"><span className="delete-modal-eyebrow">Run saved task</span><h2 id="run-task-title">{runningTask.name}</h2>{notice && <p role="status">{notice}</p>}<p className="task-help">Review the values for this run. Starting page: {runningTask.startingContext.kind === "url" ? runningTask.startingContext.url : "Current page"}. A fresh conversation will start.</p>{runningTask.parameters.filter((parameter) => parameter.mode === "run").map((parameter) => <label key={parameter.id}>{parameter.label}<ParameterInput parameter={parameter} /></label>)}<div className="delete-modal-actions"><button type="button" onClick={() => setRunningTask(undefined)}>Cancel</button><button className="delete-modal-primary" type="button" onClick={(event) => { const section = event.currentTarget.closest("section"); const values: Record<string, string> = {}; section?.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-task-input]").forEach((input) => { values[input.dataset.taskInput ?? ""] = input.value; }); void runTaskWithInputs(runningTask, values); }}>Run</button></div></section></div>}
  </>;
}

function ParameterEditor({ parameter, onChange, onRemove }: { parameter: TaskParameter; onChange: (parameter: TaskParameter) => void; onRemove: () => void }) {
  return <div className="task-parameter">
    <input aria-label="Input label" value={parameter.label} onChange={(e) => onChange({ ...parameter, label: e.target.value })} />
    <select aria-label="Input mode" value={parameter.mode} onChange={(e) => onChange({ ...parameter, mode: e.target.value as TaskParameter["mode"] })}><option value="fixed">Fixed</option><option value="run">Ask each run</option><option value="page">Read from page</option></select>
    <select aria-label="Input type" value={parameter.type} onChange={(e) => onChange({ ...parameter, type: e.target.value as TaskParameter["type"], value: undefined, defaultValue: undefined })}>{["text", "number", "date", "choice", "boolean"].map((type) => <option key={type} value={type}>{type}</option>)}</select>
    {parameter.type === "choice" && <textarea aria-label="Choices, one per line" value={parameter.options?.join("\n") ?? ""} onChange={(e) => onChange({ ...parameter, options: e.target.value.split("\n") })} />}
    {parameter.mode !== "page" && <label>{parameter.mode === "fixed" ? "Fixed value" : "Default value"}<ParameterInput parameter={parameter} value={(parameter.mode === "fixed" ? parameter.value : parameter.defaultValue) ?? ""} onChange={(value) => onChange({ ...parameter, [parameter.mode === "fixed" ? "value" : "defaultValue"]: value })} /></label>}
    <label><input type="checkbox" checked={parameter.required} onChange={(e) => onChange({ ...parameter, required: e.target.checked })} />Required</label>
    <button type="button" onClick={onRemove} aria-label={`Remove ${parameter.label}`}>Remove</button>
  </div>;
}

function ParameterInput({ parameter, value, onChange }: { parameter: TaskParameter; value?: string; onChange?: (value: string) => void }) {
  const props = { "data-task-input": parameter.id, ...(value === undefined ? { defaultValue: parameter.defaultValue ?? "" } : { value }), onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange?.(event.target.value) };
  if (parameter.type === "choice" || parameter.type === "boolean") return <select {...props}><option value="">Choose a value</option>{(parameter.type === "boolean" ? ["true", "false"] : parameter.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}</select>;
  return <input {...props} type={parameter.type === "number" || parameter.type === "date" ? parameter.type : "text"} step={parameter.type === "number" ? "any" : undefined} />;
}
