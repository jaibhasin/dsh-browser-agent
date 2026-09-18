import assert from "node:assert/strict";

const { BROWSER_AGENT_INSTRUCTIONS } = await import("../dsh-plugin/browser-agent-instructions.ts");

assert.match(BROWSER_AGENT_INSTRUCTIONS, /simple questions or basic status updates/);
assert.match(BROWSER_AGENT_INSTRUCTIONS, /one or two short sentences/);
assert.match(BROWSER_AGENT_INSTRUCTIONS, /under 60 words/);
assert.match(BROWSER_AGENT_INSTRUCTIONS, /Do not restate the user's request/);
assert.match(BROWSER_AGENT_INSTRUCTIONS, /Expand only when the user asks for detail/);
process.stdout.write("browser agent response-length guidance passed\n");
