export function formatBridgeFailure(code: string, message: string): string {
  if (/key limit exceeded\s*\(total limit\)/i.test(message) && /openrouter\.ai/i.test(message)) {
    return "OpenRouter rejected this request because the API key reached its spending limit. Increase or remove the key limit in OpenRouter, or replace the OpenRouter API key in DSH Settings > Models, then try again.";
  }

  return `${code}: ${message}`;
}
