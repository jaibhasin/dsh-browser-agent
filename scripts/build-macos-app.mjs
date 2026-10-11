import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node scripts/build-macos-app.mjs [--output <app path>] [--dsh-home <directory>]\nBuilds a native macOS launcher for an existing managed DSH installation. Requires Xcode command line tools.');
  process.exit(0);
}
if (process.platform !== 'darwin') throw new Error('This launcher is for macOS.');
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--output', '--dsh-home'].includes(args[i]) || !args[i + 1]) throw new Error('Unknown or incomplete option. Use --help.');
  options[args[i]] = args[i + 1];
}
const dshHome = resolve(options['--dsh-home'] || process.env.DSH_HOME || join(homedir(), '.dsh'));
const startPath = join(dshHome, 'dsh-browser-agent', 'start.mjs');
if (!existsSync(startPath)) throw new Error('Install the agent first with node scripts/install.mjs.');
const app = resolve(options['--output'] || join(source, '..', '.macos-build', 'DSH Browser Agent.app'));
const resources = join(app, 'Contents', 'Resources');
const binaries = join(app, 'Contents', 'MacOS');
const owner = 'jaibhasin/dsh-browser-agent:macos-launcher:1';
const marker = join(resources, '.launcher-owner');
const previousMarker = join(app, '.launcher-owner');
const existingMarker = existsSync(marker) ? marker : previousMarker;
if (existsSync(app) && (!existsSync(existingMarker) || readFileSync(existingMarker, 'utf8') !== owner)) {
  throw new Error(`Refusing to overwrite an unrelated app: ${app}`);
}
mkdirSync(resources, { recursive: true });
mkdirSync(binaries, { recursive: true });
writeFileSync(marker, owner);
if (existsSync(previousMarker)) rmSync(previousMarker);
function run(command, argv) {
  const result = spawnSync(command, argv, { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, CLANG_MODULE_CACHE_PATH: join(dirname(app), 'module-cache') } });
  if (result.status !== 0) throw new Error(`${command}: ${result.stderr || result.error?.message || result.stdout}`);
}
console.log('Building native Browser Agent launcher...');
run('/usr/bin/xcrun', ['swiftc', '-parse-as-library', '-swift-version', '5', '-O', '-module-cache-path', join(dirname(app), 'module-cache'), join(source, 'macos-launcher', 'BrowserAgent.swift'), '-o', join(binaries, 'BrowserAgent')]);
const iconTool = join(dirname(app), 'draw-icon');
run('/usr/bin/xcrun', ['swiftc', '-module-cache-path', join(dirname(app), 'module-cache'), join(source, 'macos-launcher', 'Icon.swift'), '-o', iconTool]);
const iconset = join(dirname(app), 'BrowserAgent.iconset');
mkdirSync(iconset, { recursive: true });
const png = join(dirname(app), 'BrowserAgent.png');
run(iconTool, [png]);
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    run('/usr/bin/sips', ['-z', String(size * scale), String(size * scale), png, '--out', join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)]);
  }
}
run('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(resources, 'BrowserAgent.icns')]);
cpSync(realpathSync(process.execPath), join(resources, 'node'));
cpSync(join(source, 'macos-launcher', 'supervisor.mjs'), join(resources, 'supervisor.mjs'));
writeFileSync(join(resources, 'launcher.json'), JSON.stringify({
  dshHome, startPath, logPath: join(homedir(), 'Library', 'Logs', 'DSH Browser Agent', 'agent.log'),
}, null, 2) + '\n');
writeFileSync(join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.jaibhasin.dsh-browser-agent.launcher</string>
<key>CFBundleName</key><string>DSH Browser Agent</string>
<key>CFBundleDisplayName</key><string>DSH Browser Agent</string>
<key>CFBundleExecutable</key><string>BrowserAgent</string>
<key>CFBundleIconFile</key><string>BrowserAgent</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSHumanReadableCopyright</key><string>Browser Agent by Jai Bhasin</string>
</dict></plist>\n`);
run('/usr/bin/codesign', ['--force', '--sign', '-', join(resources, 'node')]);
run('/usr/bin/codesign', ['--force', '--sign', '-', app]);
console.log(`Built ${app}\nMove this app to Applications, then open it. Closing its window keeps the agent available in the menu bar; Quit stops it.`);
