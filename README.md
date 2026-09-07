# DeepSeek Harness Browser Agent

Chrome side-panel extension backed by a local DeepSeek Harness plugin.

Human-in-the-loop is not turned on by default.

Type `/human-in-the-loop` in a chat to require human approval before the agent uses `browser_click` or `browser_navigate`.

## Agent tools

- `browser_navigate` - Opens a URL in the agent tab.
- `browser_tabs` - Lists the open browser tabs.
- `browser_snapshot` - Reads the page as DOM and accessibility text.
- `browser_wait` - Waits for the page to settle, then takes a fresh snapshot.
- `browser_screenshot` - Captures a PNG of the visible viewport.
- `browser_scroll` - Scrolls the active tab by pixels.
- `browser_click` - Clicks a visible element by reference.
- `browser_type` - Fills a visible input by reference.

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

## Install

Install Node.js 24 LTS from https://nodejs.org and Google Chrome first.
The installers target macOS, Windows (PowerShell 5.1 or newer), and Linux desktop systems.
The installer downloads its own pinned pnpm and DSH runtime; Git and a global pnpm installation are unnecessary.
The runtime uses `runtime/package-lock.json` with `npm ci`, while the plugin and extension use the frozen pnpm lockfile.
This keeps transitive DSH dependencies reproducible as well as pinning the CLI version.
Run these commands after the installer files have been published to this repository's `main` branch.

macOS and Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/jaibhasin/dsh-browser-agent/main/scripts/install.sh | bash
```

Windows PowerShell:

```powershell
$script = Join-Path $env:TEMP 'dsh-browser-install.ps1'
Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/jaibhasin/dsh-browser-agent/main/scripts/install.ps1 -OutFile $script
powershell -NoProfile -ExecutionPolicy Bypass -File $script
```

You can also download and extract the repository ZIP, then run `bash scripts/install.sh` or `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1` from it.
The scripts build a private installation in `~/.dsh/browser-agent-install` and use a separate `browser-agent-installed` profile.
Existing developer and other DSH profiles are preserved.
Set `DSH_HOME` to use a different DSH data directory.

1. Open `chrome://extensions`, enable **Developer mode**, and click **Load unpacked**.
2. Select the extension directory printed by the installer, normally `~/.dsh/browser-agent-install/extension`.
3. Run the printed `node ".../start.mjs"` command and keep that terminal open.
4. Configure your API key and select a model in DSH, then open the DSH Agent side panel in Chrome.

On macOS, press Cmd+Shift+G in the directory picker to enter the hidden directory path.
Only one browser-agent profile can run at a time because the bridge uses port 7331.
The extension contains a private local bridge token; do not share its installed directory.

### Update and uninstall

Stop the running browser-agent profile, then rerun the installer to update.
The extension directory stays at the same path; click **Reload** on its Chrome extensions card afterward.
The installer preserves the bridge token and profile configuration, builds each update in a new release directory, and retains earlier builds.
Downloads currently follow `main`; a tagged release distribution is recommended before a wider launch.

To uninstall from a checkout, run `bash scripts/uninstall.sh` on macOS/Linux or `node scripts/install.mjs --uninstall` on Windows.
The installer also prints an uninstall command that works after deleting the downloaded checkout.
Uninstall moves the managed installation and profile to timestamped `.uninstalled-*` directories, retaining credentials and history for recovery.
Remove DSH Agent from `chrome://extensions` separately to delete its Chrome storage.
You may delete the printed backup directories when you no longer need them.

## Developer setup

1. Install dependencies with `pnpm install`.
2. Run `pnpm setup:dsh-profile` to create the local DSH browser-agent profile and a shared bridge token.
3. Run `pnpm build:dsh-plugin` and `pnpm build`.
4. Load `extension/dist` as an unpacked extension in `chrome://extensions`.
5. Start DSH with `npx @deepseek-ai/dsh@0.1.2-rc.1 --profile browser-agent --no-open`.
6. Select its default model and open the extension side panel.

The setup command creates local bridge-token files that must not be committed.

## Installer verification

`pnpm test` checks installer ownership, recoverable uninstall, and DSH dependency version consistency alongside the browser state tests.
The `Installer compatibility` GitHub Actions workflow runs a full install, update, runtime boot, authenticated session creation, and uninstall on macOS, Windows, and Linux with Node.js 24.
To run that network-dependent test locally, set `DSH_INSTALL_E2E=1` and run `node --test tests/install-e2e.test.mjs`.
It uses a temporary DSH home, paths containing spaces, and temporary server ports without requiring an API key.
