import { spawnSync } from 'node:child_process';

export const chromeExtensionsUrl = 'chrome://extensions';

function launch(command, argv, spawn = spawnSync) {
  const result = spawn(command, argv, { stdio: 'ignore', detached: true });
  return !result.error && result.status === 0;
}

export function openChromeExtensionsPage({ platform = process.platform, env = process.env, spawn = spawnSync } = {}) {
  if (platform === 'darwin') {
    return launch('open', ['-a', 'Google Chrome', chromeExtensionsUrl], spawn)
      || launch('open', [chromeExtensionsUrl], spawn);
  }

  if (platform === 'win32') {
    const candidates = [
      env.LOCALAPPDATA && `${env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      env.PROGRAMFILES && `${env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      env['PROGRAMFILES(X86)'] && `${env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (launch(candidate, [chromeExtensionsUrl], spawn)) return true;
    }
    return launch('cmd.exe', ['/d', '/c', 'start', '', chromeExtensionsUrl], spawn);
  }

  for (const command of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'xdg-open']) {
    if (launch(command, [chromeExtensionsUrl], spawn)) return true;
  }
  return false;
}
