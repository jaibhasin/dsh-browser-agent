import assert from "node:assert/strict";
import test from "node:test";

const { parseTaskDraftText } = await import("../dsh-plugin/task-draft.ts");

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
      expectedResult: "A review",
    },
    questions: [{ id: "repo", question: "Which repository?", allowFreeText: true }],
  }) + "\n```", "https://www.reddit.com/r/example/comments/123");
  assert.equal(result.draft.startingContext.url, "https://www.reddit.com/r/example/comments/123");
  assert.equal(result.draft.parameters[0].type, "text");
  assert.equal(result.draft.parameters[0].mode, "run");
  assert.equal(result.questions[0].options.length, 0);
});

test("rejects malformed required task content", () => {
  assert.throws(() => parseTaskDraftText(JSON.stringify({ draft: { name: "No instructions" } })), /invalid draft/);
});
