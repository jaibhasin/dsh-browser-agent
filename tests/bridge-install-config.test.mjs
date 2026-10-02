import assert from 'node:assert/strict';
import { createPublicKey } from 'node:crypto';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseDocument } from 'yaml';
import { extensionIdFromKey, prepareExtensionIdentity } from '../scripts/extension-identity.mjs';
import { upsertBridgeIdentityPatch } from '../scripts/bridge-profile-config.mjs';

// Fixed SPKI key and the ID produced by Chrome's SHA-256/nibble mapping.
const key = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA9AsMgUqzQCgh5eH6jmzGWNhZcPApSfVxAqKemT3yDWxrcMCotR+mhmMBymAioaSvrgQDv8/cKTZwi2pDAqKCIYTJ1S/sFEoPCRL6YxzQp5uUbGMUXs4M1URgH4XqG9dnzvn0vESMmJz+hQjEw6oqh6H2lTVRJFy/3ef8ef6kkQ1ra6Yj2awblyGA7VfAhI5aEixh1NmWenakjxWKHX2SQ9hHi4BMTGupot+dZC1139dv8BTsIct9nHmdhY5kRU1abx7A27Sy6+WSQepydiO7mc2U3D6sqB06vPWM/dZat/Pi+varr5JlavoAZ6WA9O5/Vb837bu+4rDDQomB+7lD2QIDAQAB';
const id = 'cbfpfpcjmncphbdpgehomfcgpmmdphmd';
const token = 'a'.repeat(64);
const jsTag = { tag: 'tag:yaml.org,2002:js', resolve: value => value };

function parse(source) {
  const document = parseDocument(source, { customTags: [jsTag] });
  assert.equal(document.errors.length, 0);
  return document.toJS();
}

function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-identity-'));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('derives a known extension ID and rejects corrupt key material', () => {
  assert.equal(extensionIdFromKey(key), id);
  for (const value of ['', undefined, 'not a key', 'YWJj', `${key}junk`, key.slice(0, -2)]) {
    assert.throws(() => extensionIdFromKey(value));
  }
});

test('prepares a valid identity without creating or mutating the profile', () => fixture(dir => {
  const path = join(dir, 'missing-profile', '.extension-public-key');
  const generated = prepareExtensionIdentity(path);
  assert.match(generated.id, /^[a-p]{32}$/);
  assert.equal(generated.id, extensionIdFromKey(generated.key));
  assert.equal(createPublicKey({ key: Buffer.from(generated.key, 'base64'), format: 'der', type: 'spki' }).asymmetricKeyType, 'rsa');
  assert.equal(existsSync(join(dir, 'missing-profile')), false);
}));

test('reuses a persisted key and can recover it from the installed manifest', () => fixture(dir => {
  const path = join(dir, '.extension-public-key');
  assert.deepEqual(prepareExtensionIdentity(path, key), { key, id });
  assert.equal(existsSync(path), false);
  writeFileSync(path, `${key}\n`);
  assert.deepEqual(prepareExtensionIdentity(path), { key, id });
  assert.equal(readFileSync(path, 'utf8'), `${key}\n`);
  writeFileSync(path, 'corrupt');
  assert.throws(() => prepareExtensionIdentity(path, key));
  assert.equal(readFileSync(path, 'utf8'), 'corrupt');
}));

test('creates a bridge entry in a new or empty patch', () => {
  for (const source of ['', '[]', '# empty profile\n']) {
    assert.deepEqual(parse(upsertBridgeIdentityPatch(source, id, token)), [{ id: 'dsh-browser-agent', config: { token, extensionId: id, port: 7331 } }]);
  }
});

test('writes the configured identity as an ordinary scalar instead of retaining a !!js tag', () => {
  for (const previous of ['process.env.OLD_EXTENSION_ID', id]) {
    const source = `- id: dsh-browser-agent\n  config:\n    extensionId: !!js ${previous}\n`;
    const output = upsertBridgeIdentityPatch(source, id, token);
    assert.equal(parse(output)[0].config.extensionId, id);
    assert.doesNotMatch(output, /!!js/);
  }
});

test('updates only the browser-agent identity when other plugins have tokens and IDs', () => {
  const source = `# custom profile\n- id: foreign\n  config:\n    token: keep-me\n    extensionId: ${'b'.repeat(32)}\n- id: dsh-browser-agent\n  config:\n    token: ${token}\n    extensionId: ${'c'.repeat(32)}\n    port: 8444\n    custom: keep\n- id: webserver\n  config:\n    port: 0\n`;
  const output = upsertBridgeIdentityPatch(source, id, token);
  const before = parse(source);
  before[1].config.extensionId = id;
  assert.deepEqual(parse(output), before);
  assert.match(output, /# custom profile/);
  assert.equal(upsertBridgeIdentityPatch(output, id, token), output);
});

test('inserts a missing identity without changing foreign configuration or tagged expressions', () => {
  const source = '- id: foreign\n  config:\n    extensionId: untouched\n- id: "dsh-browser-agent"\n  config:\n    token: !!js process.env.DSH_BROWSER_BRIDGE_TOKEN\n    port: 8444\n';
  const output = upsertBridgeIdentityPatch(source, id, token);
  assert.equal(parse(output)[0].config.extensionId, 'untouched');
  assert.equal(parse(output)[1].config.extensionId, id);
  assert.match(output, /!!js process\.env\.DSH_BROWSER_BRIDGE_TOKEN/);
  assert.equal(parse(output)[1].config.port, 8444);
});

test('handles reordered keys, flow YAML, JSON and alternate indentation', () => {
  for (const source of [
    '- config:\n    port: 9444\n  id: dsh-browser-agent\n',
    '[{id: dsh-browser-agent, config: {port: 9444}}]',
    '[{"id":"dsh-browser-agent","config":{"port":9444}}]',
    '- id: dsh-browser-agent\n  config:\n      port: 9444\n',
  ]) {
    assert.deepEqual(parse(upsertBridgeIdentityPatch(source, id, token)), [{ id: 'dsh-browser-agent', config: { port: 9444, extensionId: id } }]);
  }
});

test('adds an absent entry and creates an absent config mapping', () => {
  assert.equal(parse(upsertBridgeIdentityPatch('- id: foreign\n', id, token))[1].config.extensionId, id);
  for (const source of ['- id: dsh-browser-agent\n', '- id: dsh-browser-agent\n  config: null\n']) {
    assert.equal(parse(upsertBridgeIdentityPatch(source, id, token))[0].config.extensionId, id);
  }
});

test('fails safely on duplicate entries/keys, invalid root, invalid config, aliases and malformed YAML', () => {
  for (const source of [
    '- id: dsh-browser-agent\n- id: dsh-browser-agent\n',
    '- id: dsh-browser-agent\n  id: dsh-browser-agent\n',
    'plugins: []',
    '- foreign',
    '- id: dsh-browser-agent\n  config: wrong\n',
    '- id: dsh-browser-agent\n  config: []\n',
    '- id: foreign\n  config: &shared {port: 7331}\n- id: dsh-browser-agent\n  config: *shared\n',
    '- id: dsh-browser-agent\n  config: {extensionId: one, extensionId: two}\n',
    '[invalid',
  ]) assert.throws(() => upsertBridgeIdentityPatch(source, id, token));
});

test('preserves CRLF line endings', () => {
  const output = upsertBridgeIdentityPatch('- id: dsh-browser-agent\r\n  config:\r\n    port: 7331\r\n', id, token);
  assert.equal(output.replace(/\r\n/g, '').includes('\n'), false);
  assert.equal(parse(output)[0].config.extensionId, id);
});
