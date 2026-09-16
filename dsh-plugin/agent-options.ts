import type { AgentOptions } from "@deepseek-ai/dsh-agent";

export const BROWSER_AGENT_MAX_TOKENS = 16_384;
export const TASK_DRAFT_MAX_TOKENS = 4_096;

export function createBrowserAgentOptions(
  provider: string,
  model: string,
  overrides: Pick<AgentOptions, "maxTokens"> = {},
): AgentOptions {
  return { provider, model, maxTokens: BROWSER_AGENT_MAX_TOKENS, ...overrides };
}
