import { spawn } from 'node:child_process';

export const chromeExtensionsUrl = 'chrome://extensions';

function launch(command, argv, spawnProcess = spawn) {
  try {
    const child = spawnProcess(command, argv, { stdio: 'ignore', detached: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export function openChromeExtensionsPage({ platform = process.platform, env = process.env, spawn: spawnProcess = spawn } = {}) {
  if (env.CI === 'true' || env.CI === '1') return false;

  if (platform === 'darwin') {
    return launch('open', ['-a', 'Google Chrome', chromeExtensionsUrl], spawnProcess)
      || launch('open', [chromeExtensionsUrl], spawnProcess);
  }

  if (platform === 'win32') {
    const candidates = [
      env.LOCALAPPDATA && `${env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      env.PROGRAMFILES && `${env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      env['PROGRAMFILES(X86)'] && `${env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (launch(candidate, [chromeExtensionsUrl], spawnProcess)) return true;
    }
    return launch('cmd.exe', ['/d', '/c', 'start', '', chromeExtensionsUrl], spawnProcess);
  }

  for (const command of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'xdg-open']) {
    if (launch(command, [chromeExtensionsUrl], spawnProcess)) return true;
  }
  return false;
}
