import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const installer = resolve('scripts/install.mjs');
test('runtime lock contains only the supported DSH release, including projection cache', () => {
  const lock = JSON.parse(readFileSync('runtime/package-lock.json', 'utf8'));
  const packages = Object.entries(lock.packages).filter(([path]) => /node_modules\/@deepseek-ai\/dsh(?:-[^/]+)?$/.test(path));
  assert.ok(packages.length > 0);
  for (const [path, pkg] of packages) assert.equal(pkg.version, '0.1.2-rc.1', path);
  assert.equal(lock.packages['node_modules/@deepseek-ai/dsh-session-projection-cache'].version, '0.1.2-rc.1');
  assert.ok(!lock.packages['node_modules/@deepseek-ai/dsh-host-apiproxy']);
});
function fixture(fn) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-install-test-'));
  try { fn(home); } finally { rmSync(home, { recursive: true, force: true }); }
}
function invoke(home, ...args) {
  return spawnSync(process.execPath, [installer, ...args], {
    env: { ...process.env, DSH_HOME: home }, encoding: 'utf8',
  });
}

test('refuses an existing unmanaged profile without changing it', () => fixture(home => {
  const profile = join(home, 'profiles', 'browser-agent-installed');
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(profile, 'package.json'), '{"private":true}');
  const result = invoke(home);
  assert.equal(result.status, 1);
  assert.equal(readFileSync(join(profile, 'package.json'), 'utf8'), '{"private":true}');
  assert.deepEqual(readdirSync(home), ['profiles']);
}));

test('uninstall archives owned files and leaves other profiles intact', () => fixture(home => {
  for (const path of ['browser-agent-install', 'profiles/browser-agent-installed']) {
    mkdirSync(join(home, path), { recursive: true });
    writeFileSync(join(home, path, '.installer-owner'), 'jaibhasin/dsh-browser-agent:1');
    writeFileSync(join(home, path, 'user-data'), 'keep me');
  }
  mkdirSync(join(home, 'profiles', 'web'));
  const result = invoke(home, '--uninstall');
  assert.equal(result.status, 0, result.stderr);
  const backup = readdirSync(home).find(name => name.startsWith('browser-agent-install.uninstalled-'));
  assert.equal(readFileSync(join(home, backup, 'user-data'), 'utf8'), 'keep me');
  assert.ok(readdirSync(join(home, 'profiles')).includes('web'));
  assert.equal(invoke(home, '--uninstall').status, 0);
}));

test('uninstall validates both targets before moving either', () => fixture(home => {
  const root = join(home, 'browser-agent-install');
  mkdirSync(root);
  writeFileSync(join(root, '.installer-owner'), 'jaibhasin/dsh-browser-agent:1');
  mkdirSync(join(home, 'profiles', 'browser-agent-installed'), { recursive: true });
  assert.equal(invoke(home, '--uninstall').status, 1);
  assert.ok(readdirSync(home).includes('browser-agent-install'));
}));
