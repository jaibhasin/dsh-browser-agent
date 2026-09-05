# DeepSeek Harness Browser Agent

Chrome side-panel extension backed by a local DeepSeek Harness plugin.

- `browser_snapshot` - Returns an accessibility snapshot of the agent-owned tab.
- `browser_screenshot` - Captures the agent-owned tab's visible viewport as a PNG.
- `browser_scroll` - Scrolls the agent-owned tab in a chosen direction by a pixel amount.
- `browser_click` - Clicks a visible, enabled element from the latest snapshot.
- `browser_type` - Fills a visible text control from the latest snapshot.
- `browser_navigate` - Navigates the agent-owned tab to an HTTP or HTTPS URL.
- `browser_tabs` - Lists every open browser tab.
- `browser_wait` - Waits briefly for a loading page to become quiet, then returns a fresh snapshot.

## Chats and tabs

The side panel saves up to 100 chats in Chrome local storage.
Each saved chat contains its visible messages, browser tool activity, and visited HTTP(S) links.
Opening a saved chat reuses its DSH session ID so the local DSH runtime can resume its durable context.
Chat history is separate from diagnostic logs and is never committed to this repository.

The first message in a session assigns the current browser tab to the agent.

Switching tabs pauses an active task, and the side panel lets you resume it on the assigned tab, continue it in the background, or stop it and move the agent to the visible tab.
The assigned tab appears in a blue Chrome tab group named `Agent`.
DOM actions work in the assigned background tab, but screenshots require that tab to be visible.

## Setup

1. Install dependencies with `pnpm install`.
2. Run `pnpm setup:dsh-profile` to create the local DSH browser-agent profile and a shared bridge token.
3. Run `pnpm build`.
4. Load `extension/dist` as an unpacked extension in `chrome://extensions`.
5. Start DSH with `npx @deepseek-ai/dsh@0.1.2-rc.1 --profile browser-agent --no-open`.
6. Select its default model and open the extension side panel.

The setup command creates local bridge-token files that must not be committed.
