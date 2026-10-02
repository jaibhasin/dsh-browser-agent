import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { openChromeExtensionsPage } from './open-chrome-extensions.mjs';
import { prepareExtensionIdentity } from './extension-identity.mjs';

const profileName = 'dsh-browser-agent';
const owner = 'jaibhasin/dsh-browser-agent:1';
const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dshHome = resolve(process.env.DSH_HOME || join(homedir(), '.dsh'));
const root = join(dshHome, 'dsh-browser-agent');
const legacyRoot = join(dshHome, 'browser-agent-install');
const profile = join(dshHome, 'profiles', profileName);
const args = process.argv.slice(2);

export const installerWorkspaceFilters = ['.', './dsh-plugin'];

function run(command, argv, cwd) {
  const result = spawnSync(command, argv, { cwd, encoding: 'utf8', env: process.env, maxBuffer: 20 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    throw new Error(`${command} failed: ${result.error?.message || result.status}`);
  }
}
function write(path, text) { writeFileSync(path, text, { mode: 0o600 }); }
function json(path, value) { write(path, `${JSON.stringify(value, null, 2)}\n`); }
function checkOwned(path) {
  if (!existsSync(path)) return;
  if (lstatSync(path).isSymbolicLink() || !existsSync(join(path, '.installer-owner')) || readFileSync(join(path, '.installer-owner'), 'utf8') !== owner) {
    throw new Error(`Refusing to modify an unmanaged directory: ${path}`);
  }
}

async function main() {
  if (args.includes('--help')) {
    console.log('Usage: node scripts/install.mjs [--uninstall]\nSupports macOS, Windows and Linux. Requires Node.js 22.19+ (22.x), or 24+, and internet access.\nDSH_HOME selects the DSH data directory. Stop this browser profile before updating.');
    return;
  }
  if (args.some(arg => arg !== '--uninstall')) throw new Error('Unknown option. Use --help.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!((major === 22 && minor >= 19) || major >= 24)) throw new Error('Install Node.js 24 LTS from https://nodejs.org.');
  // Both paths must belong to this installer before any mutation takes place.
  if (existsSync(legacyRoot)) {
    checkOwned(legacyRoot);
    if (existsSync(root)) throw new Error(`Both the old and new installation directories exist: ${legacyRoot} and ${root}`);
    renameSync(legacyRoot, root);
  }
  checkOwned(root);
  checkOwned(profile);
  if (args.includes('--uninstall')) {
    if (existsSync(join(root, '.install-lock'))) throw new Error('An installation is in progress. Wait for it to finish before uninstalling.');
    // Move the installation out of service without deleting credentials or history.
    const suffix = `.uninstalled-${Date.now()}`;
    if (existsSync(profile)) renameSync(profile, profile + suffix);
    if (existsSync(root)) renameSync(root, root + suffix);
    console.log(`Uninstalled. Existing files were retained at their original paths plus ${suffix}.\nRemove dsh Browser Agent in chrome://extensions to remove extension data too.`);
    return;
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  write(join(root, '.installer-owner'), owner);
  const lock = join(root, '.install-lock');
  try { mkdirSync(lock); } catch { throw new Error(`Another install may be running. If it was interrupted, remove ${lock} and retry.`); }
  let stage;
  try {
    stage = mkdtempSync(join(root, 'release-'));
    const excluded = new Set(['node_modules', '.git', '.env.local', 'dist', '.gstack', '.agents', '.codex']);
    for (const entry of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'vite.config.js', 'dsh-plugin', 'extension', 'shared', 'scripts', 'runtime']) {
      cpSync(join(source, entry), join(stage, entry), {
        recursive: true,
        filter: path => !excluded.has(basename(path)),
      });
    }
    const tokenPath = join(profile, '.bridge-token');
    const keyPath = join(profile, '.extension-public-key');
    const installedManifestPath = join(root, 'extension', 'manifest.json');
    const installedKey = existsSync(installedManifestPath) ? JSON.parse(readFileSync(installedManifestPath, 'utf8')).key : undefined;
    const { key: extensionKey, id: extensionId } = prepareExtensionIdentity(keyPath, installedKey);
    const token = existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8').trim() : randomBytes(32).toString('hex');
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error(`Invalid bridge token in ${tokenPath}`);
    const patchPath = join(profile, 'cordis.patch.yml');
    write(join(stage, 'extension', '.env.local'), `VITE_DSH_BRIDGE_TOKEN=${token}\nVITE_DSH_EXTENSION_ID=${extensionId}\nVITE_DSH_EXTENSION_KEY=${extensionKey}\n`);
    // Invoke npm's JS entry point directly on Windows, avoiding shell quoting of paths.
    const npm = process.platform === 'win32' ? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js') : null;
    const npmCommand = npm ? process.execPath : 'npm';
    const npmPrefix = npm ? [npm] : [];
    const pnpm = (...argv) => run(npmCommand, [...npmPrefix, 'exec', '--yes', '--package=pnpm@11.8.0', '--', 'pnpm', ...argv], stage);
    console.log('\ndsh Browser Agent setup\n\n[1/4] Downloading build tools and dependencies. This can take a few minutes...');
    pnpm('install', '--frozen-lockfile', ...installerWorkspaceFilters.flatMap(filter => ['--filter', filter]));
    // Load YAML support from the staged install: the bootstrap checkout has no dependencies.
    const { upsertBridgeIdentityPatch } = await import(pathToFileURL(join(stage, 'scripts', 'bridge-profile-config.mjs')).href);
    const bridgePatch = upsertBridgeIdentityPatch(existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '', extensionId, token);
    console.log('[2/4] Building your browser extension and plugin...');
    pnpm('run', 'build:dsh-plugin');
    pnpm('run', 'build');
    // Keep the pinned DSH runtime local, so starting later does not invoke npx.
    const runtime = join(stage, 'runtime');
    console.log('[3/4] Installing the compatible DSH version. First-time setup can take a few minutes...');
    run(npmCommand, [...npmPrefix, 'ci', '--no-audit', '--no-fund'], runtime);
    const pluginScope = join(runtime, 'node_modules', '@jaibhasin');
    mkdirSync(pluginScope, { recursive: true });
    symlinkSync(join(stage, 'dsh-plugin'), join(pluginScope, 'dsh-browser-agent'), process.platform === 'win32' ? 'junction' : 'dir');
    const dshPackage = JSON.parse(readFileSync(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'));
    const bin = typeof dshPackage.bin === 'string' ? dshPackage.bin : dshPackage.bin?.dsh;
    if (!bin) throw new Error('The pinned DSH package has no CLI entry point.');
    const executable = join(runtime, 'node_modules', '@deepseek-ai', 'dsh', bin);
    if (!existsSync(executable)) throw new Error('The pinned DSH CLI entry point is missing.');
    const extension = join(root, 'extension');
    const backup = join(root, `extension-backup-${Date.now()}`);
    const manifestPath = join(profile, 'package.json');
    const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {
      name: 'dsh-profile-browser-agent', private: true,
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@jaibhasin/dsh-browser-agent'] } },
    };
    manifest.dependencies = { ...manifest.dependencies, '@jaibhasin/dsh-browser-agent': `link:${join(stage, 'dsh-plugin')}` };
    const hadExtension = existsSync(extension);
    console.log('[4/4] Setting up your private browser-agent profile...');
    if (hadExtension) renameSync(extension, backup);
    try { cpSync(join(stage, 'extension', 'dist'), extension, { recursive: true }); }
    catch (error) {
      rmSync(extension, { recursive: true, force: true });
      if (hadExtension) renameSync(backup, extension);
      throw error;
    }
    mkdirSync(profile, { recursive: true, mode: 0o700 });
    write(join(profile, '.installer-owner'), owner);
    write(keyPath, `${extensionKey}\n`);
    const profileModules = join(profile, 'node_modules');
    if (existsSync(profileModules)) renameSync(profileModules, join(profile, `node_modules-backup-${Date.now()}`));
    symlinkSync(join(runtime, 'node_modules'), profileModules, process.platform === 'win32' ? 'junction' : 'dir');
    write(tokenPath, `${token}\n`);
    if (!existsSync(join(profile, 'cordis.yml'))) write(join(profile, 'cordis.yml'), '[]\n');
    write(patchPath + '.tmp', bridgePatch);
    renameSync(patchPath + '.tmp', patchPath);
    json(manifestPath + '.tmp', manifest);
    renameSync(manifestPath + '.tmp', manifestPath);
    write(join(root, 'start.mjs'), `import { pathToFileURL } from 'node:url';\nprocess.env.DSH_HOME = ${JSON.stringify(dshHome)};\nconst executable = ${JSON.stringify(executable)};\nprocess.argv = [process.execPath, executable, '--profile', '${profileName}', '--no-open'];\nconst { runCli } = await import(pathToFileURL(executable).href);\nif (typeof runCli !== 'function') throw new Error('The pinned DSH CLI has no runnable entry point.');\nawait runCli();\n`);
    console.log([
      '',
      'Setup complete! Finish these steps:',
      '',
      '1. Copy and run this command in your terminal before loading or reloading the extension:',
      '',
      `   node "${join(root, 'start.mjs')}"`,
      '',
      '   Keep that terminal open while using dsh Browser Agent.',
      '2. In Chrome, open chrome://extensions and turn on "Developer mode" using the switch in the top-right corner.',
      '3. Click "Load unpacked" in the top-left corner and select this folder (the folder itself, not a file inside it):',
      '',
      `   ${extension}`,
      '',
      '   On Mac: press Cmd+Shift+G in the folder picker, paste the path,',
      '   press Return, then click Select.',
      "   On Windows: paste the path into the folder picker's address bar,",
      '   press Enter, then click Select Folder.',
      '   On Linux: press Ctrl+L in the folder picker, paste the path,',
      '   press Enter, then select the folder.',
      ...(hadExtension ? ['   Already have dsh Browser Agent installed? Click its circular Reload button instead of loading it again.'] : []),
      '4. Open the local web address printed by DSH. Configure your API key',
      '   and choose a model there.',
      '5. In Chrome, click the puzzle-piece Extensions button, then dsh Browser Agent',
      '   to open its side panel. You can now start chatting!',
      '',
      'Next time, start DSH with the command in step 1 and open dsh Browser Agent.',
      'To stop it, press Ctrl+C in the DSH terminal.',
      'If port 7331 or 3080 is busy, stop your other DSH instance first.',
      '',
      'To uninstall on any platform, stop DSH and run:',
      `   node "${join(stage, 'scripts', 'install.mjs')}" --uninstall`,
      'Then remove dsh Browser Agent from chrome://extensions.',
      `Previous builds are retained in ${root}.`,
    ].join('\n'));
    if (openChromeExtensionsPage()) console.log('Chrome has been opened to chrome://extensions.');
    else console.log('Could not open Chrome automatically. Open chrome://extensions manually.');
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Installation failed: ${error.message}`); process.exitCode = 1; });
}
