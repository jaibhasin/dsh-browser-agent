import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

export function setupInstructions(extensionDirectory) {
  return [
    "",
    "  Set up Chrome",
    "  1. Open chrome://extensions in the test window.",
    "  2. Turn on Developer mode, then click Load unpacked.",
    `     Choose: ${extensionDirectory}`,
    "  3. Open dsh Browser Agent from Chrome's Extensions menu.",
    "     Already installed? Click Reload on its extension card.",
    "",
    "  Then open your web tabs and choose Memory test in the side panel.",
    "  Start DSH before running tasks.",
    "",
    "  extensions  Open extension manager",
    "  status      Check connections and memory",
    "  help        Show setup steps again",
    "  stop        Save report and finish",
    "",
  ].join("\n");
}

export async function openBenchmarkExtensions(profileDirectory, {
  platform = process.platform,
  spawnProcess = spawn,
  userHome = homedir(),
} = {}) {
  const args = [
    `--user-data-dir=${profileDirectory}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
    "chrome://extensions/",
  ];
  // Launch Chrome directly so a running macOS app receives the profile and URL.
  const candidates = platform === "darwin" ? [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    join(userHome, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
  ] : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
  for (const command of candidates) {
    const opened = await new Promise((resolve) => {
      try {
        const child = spawnProcess(command, args, { detached: true, stdio: "ignore" });
        child.once("error", () => resolve(false));
        child.once("spawn", () => { child.unref(); resolve(true); });
      } catch { resolve(false); }
    });
    if (opened) return true;
  }
  return false;
}
