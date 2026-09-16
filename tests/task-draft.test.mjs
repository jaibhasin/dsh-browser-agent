import assert from "node:assert/strict";
import test from "node:test";

const { BROWSER_AGENT_MAX_TOKENS, TASK_DRAFT_MAX_TOKENS, createBrowserAgentOptions } = await import("../dsh-plugin/agent-options.ts");
const { getTaskDraftTurnError, parseTaskDraftText, parseTaskDraftWithRetry } = await import("../dsh-plugin/task-draft.ts");

test("uses bounded output budgets for browser and task agents", () => {
  assert.equal(BROWSER_AGENT_MAX_TOKENS, 16_384);
  assert.equal(TASK_DRAFT_MAX_TOKENS, 4_096);
  assert.deepEqual(createBrowserAgentOptions("openrouter", "anthropic/claude-sonnet-5"), {
    provider: "openrouter",
    model: "anthropic/claude-sonnet-5",
    maxTokens: 16_384,
  });
  assert.equal(createBrowserAgentOptions("openrouter", "anthropic/claude-sonnet-5", { maxTokens: TASK_DRAFT_MAX_TOKENS }).maxTokens, 4_096);
});

test("reads model request failures from the completed task draft turn", () => {
  const error = getTaskDraftTurnError([
    { type: "turn/end", data: { reason: { kind: "error", error: { message: "402: request exceeds the provider limit" } } } },
  ]);
  assert.match(error?.message ?? "", /402: request exceeds the provider limit/);
});

test("accepts a minimal model draft when optional empty fields are omitted", () => {
  const result = parseTaskDraftText(JSON.stringify({
    draft: {
      name: "Review the current post",
      instructions: "Review the current Reddit post and summarize the key points.",
      startingContext: { kind: "current-page" },
      parameters: [],
      constraints: "",
      expectedResult: "A concise summary",
    },
  }));
  assert.deepEqual(result.questions, []);
  assert.deepEqual(result.draft.warnings, []);
});

test("normalizes common model aliases without changing task intent", () => {
  const result = parseTaskDraftText("```json\n" + JSON.stringify({
    draft: {
      name: "Check a pull request",
      instructions: "Review the pull request.",
      startingContext: { kind: "saved-url" },
      parameters: [{ id: "pr", label: "Pull request", type: "string", mode: "runtime", required: false }],
      constraints: "",
      expectedResult: "A review",
    },
    questions: [{ id: "repo", question: "Which repository?", allowFreeText: true }],
  }) + "\n```", "https://www.reddit.com/r/example/comments/123");
  assert.equal(result.draft.startingContext.url, "https://www.reddit.com/r/example/comments/123");
  assert.equal(result.draft.parameters[0].type, "text");
  assert.equal(result.draft.parameters[0].mode, "run");
  assert.equal(result.questions[0].options.length, 0);
});

test("preserves scalar parameter values and options", () => {
  const result = parseTaskDraftText(JSON.stringify({
    draft: {
      name: "Run with inputs",
      instructions: "Use the supplied inputs.",
      startingContext: { kind: "current-page" },
      parameters: [
        { id: "count", label: "Count", type: "number", mode: "fixed", value: 5, required: true },
        { id: "enabled", label: "Enabled", type: "boolean", mode: "run", defaultValue: false, required: false },
        { id: "kind", label: "Kind", type: "choice", mode: "run", options: ["fast", 2], required: true },
      ],
      constraints: "",
      expectedResult: "Done",
    },
    questions: [],
  }));
  assert.equal(result.draft.parameters[0].value, "5");
  assert.equal(result.draft.parameters[1].defaultValue, "false");
  assert.deepEqual(result.draft.parameters[2].options, ["fast", "2"]);
});

test("retries once when the first task draft is malformed", async () => {
  const prompts = [];
  const result = await parseTaskDraftWithRetry(async (prompt) => {
    prompts.push(prompt);
    if (prompts.length === 1) return JSON.stringify({ draft: { name: "Missing fields" } });
    return JSON.stringify({
      draft: {
        name: "Recovered task",
        instructions: "Use the current page.",
        startingContext: { kind: "current-page" },
        parameters: [],
        constraints: "",
        expectedResult: "Done",
      },
      questions: [],
    });
  }, "Build this task");
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /required task schema/);
  assert.equal(result.draft.name, "Recovered task");
});

test("does not retry a failed model request as malformed JSON", async () => {
  let calls = 0;
  await assert.rejects(
    parseTaskDraftWithRetry(async () => {
      calls += 1;
      throw new Error("402: request exceeds the provider limit");
    }, "Build this task"),
    /402: request exceeds the provider limit/,
  );
  assert.equal(calls, 1);
});

test("rejects malformed required task content", () => {
  assert.throws(() => parseTaskDraftText(JSON.stringify({ draft: { name: "No instructions" } })), /invalid draft/);
});

test("accepts the observed list constraints and editable count without a retry", async () => {
  let calls = 0;
  const result = await parseTaskDraftWithRetry(async () => {
    calls++;
    return JSON.stringify({ draft: {
      name: "Check recent posts", instructions: "Read the latest posts and report scores.",
      startingContext: { kind: "url", url: "https://www.reddit.com/" },
      parameters: [{ id: "postCount", label: "Post count", type: "number", mode: "editable", defaultValue: 3, required: true }],
      constraints: ["Only read posts.", "Verify scores."], expectedResult: "Post scores", warnings: [],
    }, questions: [] });
  }, "Build a reusable task");
  assert.equal(calls, 1);
  assert.equal(result.draft.constraints, "Only read posts.\nVerify scores.");
  assert.equal(result.draft.parameters[0].mode, "run");
  assert.equal(result.draft.parameters[0].defaultValue, "3");
});

test("rejects missing semantic fields instead of inventing them", () => {
  assert.throws(() => parseTaskDraftText(JSON.stringify({
    draft: {
      name: "Incomplete task",
      instructions: "Do the thing.",
      constraints: "",
      expectedResult: "Done",
    },
  })), /invalid draft/);
});
