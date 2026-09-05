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

- Chats are saved locally with messages, tool activity, and recent website links.
- A chat owns one browser tab, and a tab belongs to one chat.
- Creating a new chat on an owned tab removes the old chat for that tab.
- Opening a saved chat focuses its tab, or recreates it at its last saved website.
- Switching away during work asks whether to continue, pause, quit, or move the chat.
- If that tab already has a saved chat, you can start new or continue the saved chat.
- A paused chat stays saved. A quit chat is deleted.
- The current agent tab is marked with a blue `Agent` tab group.
- Browser actions stay on the assigned tab. Screenshots require that tab to be visible.

## Setup

1. Install dependencies with `pnpm install`.
2. Run `pnpm setup:dsh-profile` to create the local DSH browser-agent profile and a shared bridge token.
3. Run `pnpm build`.
4. Load `extension/dist` as an unpacked extension in `chrome://extensions`.
5. Start DSH with `npx @deepseek-ai/dsh@0.1.2-rc.1 --profile browser-agent --no-open`.
6. Select its default model and open the extension side panel.

The setup command creates local bridge-token files that must not be committed.
