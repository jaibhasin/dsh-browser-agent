# DeepSeek Harness Browser Agent

Chrome side-panel extension backed by a local DeepSeek Harness plugin.

It provides `browser_snapshot`, `browser_scroll`, `browser_click`, and `browser_screenshot`.
It also provides `browser_type(ref, text)` for filling visible text controls.

`browser_scroll` takes a direction (`up`, `down`, `left`, or `right`) and a pixel value from 1 to 1,000,000.
It returns a fresh snapshot after scrolling.
`browser_click` uses a visible, enabled `ref` from the latest snapshot.
`browser_screenshot` attaches the active tab's visible viewport as a PNG image.

## Workspace

All chats use one persistent agent session in the single `dsh-browser-agent` DSH workspace.

There are no per-tab, per-window, per-page, or separate side-panel chat workspaces.

## Setup

1. Install dependencies with `pnpm install`.
2. Run `pnpm setup:dsh-profile` to create the local DSH browser-agent profile and a shared bridge token.
3. Run `pnpm build`.
4. Load `extension/dist` as an unpacked extension in `chrome://extensions`.
5. Start the `browser-agent` DSH profile, select its default model, and open the extension side panel.

The setup command creates local bridge-token files that must not be committed.
