# DeepSeek Harness Browser Agent

Chrome side-panel extension backed by a local DeepSeek Harness plugin.

- `browser_snapshot` - Returns an accessibility snapshot of the agent-owned tab.
- `browser_screenshot` - Captures the agent-owned tab's visible viewport as a PNG.
- `browser_scroll` - Scrolls the agent-owned tab in a chosen direction by a pixel amount.
- `browser_click` - Clicks a visible, enabled element from the latest snapshot.
- `browser_type` - Fills a visible text control from the latest snapshot.
- `browser_navigate` - Navigates the agent-owned tab to an HTTP or HTTPS URL.
- `browser_tabs` - Lists every open browser tab.
- `browser_switch_tab` - Focuses the specified browser tab.
- `browser_wait` - Waits briefly for a loading page to become quiet, then returns a fresh snapshot.

## Workspace

All chats use one persistent agent session in the single `dsh-browser-agent` DSH workspace.

There are no per-tab, per-window, per-page, or separate side-panel chat workspaces.

The first message in a session assigns the current browser tab to the agent.

Changing the visible browser tab does not move the agent.
The side panel offers an explicit switch action when it detects a different visible tab.
The assigned tab is shown in a blue Chrome tab group named `Agent`; moving the agent removes the marker from the previous tab.

Chrome can run DOM-based actions in an assigned background tab, including snapshots, clicks, typing, scrolling, waits, and navigation.
Screenshots require the assigned tab to be visible and fail instead of capturing an unrelated active tab.

## Setup

1. Install dependencies with `pnpm install`.
2. Run `pnpm setup:dsh-profile` to create the local DSH browser-agent profile and a shared bridge token.
3. Run `pnpm build`.
4. Load `extension/dist` as an unpacked extension in `chrome://extensions`.
5. Start the `browser-agent` DSH profile, select its default model, and open the extension side panel.

The setup command creates local bridge-token files that must not be committed.
