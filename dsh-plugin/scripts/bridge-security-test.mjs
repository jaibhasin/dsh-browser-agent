import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createConnection, createServer } from 'node:net';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { DshBrowserWebSocketBridge } from '../dist/dsh-plugin/websocket/server.js';

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const origin = `chrome-extension://${extensionId}`;
const token = 'a'.repeat(64);
const clientId = '11111111-1111-4111-8111-111111111111';
const hello = { type: 'hello', protocolVersion: 2, token, client: 'chrome-extension', clientId };

/** Reserve a free loopback port for the bridge fixture. */
async function freePort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  return port;
}

/** Assert rejection at HTTP upgrade, rather than accepting unrelated connection failures. */
async function rejectUpgrade(url, headers) {
  const socket = new WebSocket(url, { headers, handshakeTimeout: 2_000 });
  try {
    const status = await new Promise((resolve, reject) => {
      socket.once('unexpected-response', (_request, response) => {
        response.resume();
        socket.terminate();
        resolve(response.statusCode);
      });
      socket.once('open', () => reject(new Error('Unexpected successful WebSocket upgrade.')));
      socket.once('error', reject);
    });
    assert.equal(status, 403);
  } finally { socket.terminate(); }
}

/** Read the actual upgrade status for a request which intentionally omits Host. */
async function statusWithoutHost(port) {
  const socket = createConnection({ host: '127.0.0.1', port });
  try {
    await once(socket, 'connect');
    socket.setTimeout(2_000, () => socket.destroy(new Error('Handshake timeout')));
    socket.write(`GET / HTTP/1.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: MDEyMzQ1Njc4OWFiY2RlZg==\r\nOrigin: ${origin}\r\n\r\n`);
    const [data] = await once(socket, 'data');
    return Number(data.toString().match(/^HTTP\/1\.1 (\d+)/)?.[1]);
  } finally { socket.destroy(); }
}

/** Complete the HTTP upgrade and collect protocol frames through the server's close. */
async function rejectHello(url, message, expectedCode) {
  const socket = new WebSocket(url, { headers: { origin }, handshakeTimeout: 2_000 });
  const frames = [];
  socket.on('message', data => frames.push(JSON.parse(data.toString())));
  try {
    await once(socket, 'open');
    const closed = once(socket, 'close', { signal: AbortSignal.timeout(7_000) });
    if (message) socket.send(JSON.stringify(message));
    const [code] = await closed;
    assert.equal(code, expectedCode);
    assert.equal(frames.some(frame => frame.type === 'welcome'), false);
  } finally { socket.terminate(); }
}

test('bridge validates identity and local headers before authentication', { timeout: 30_000 }, async t => {
  const port = await freePort();
  const url = `ws://127.0.0.1:${port}`;
  const bridge = new DshBrowserWebSocketBridge({ token, extensionId, port, host: undefined });
  await bridge.start();
  try {
    for (const value of [undefined, 'null', 'https://example.test', `chrome-extension://${'b'.repeat(32)}`, 'chrome-extension://', `${origin}/`, `${origin}/page`, `${origin}:7331`, `${origin}?x=1`, `${origin}#x`, `chrome-extension://user@${extensionId}`, `${origin}.evil`, origin.toUpperCase(), `${origin}, ${origin}`]) {
      await t.test(`rejects Origin ${String(value)}`, () => rejectUpgrade(url, value === undefined ? {} : { origin: value }));
    }
    for (const host of ['example.test', '127.0.0.1.evil', 'localhost.evil', '127.0.0.1@evil', '0.0.0.0', '[::]', 'localhost:0', '127.0.0.1:65536', 'localhost:bad', '127.0.0.1, localhost']) {
      await t.test(`rejects Host ${host}`, () => rejectUpgrade(url, { origin, host }));
    }
    await t.test('rejects missing Host', async () => assert.ok([400, 403].includes(await statusWithoutHost(port))));
    await t.test('rejects wrong token', () => rejectHello(url, { ...hello, token: 'b'.repeat(64) }, 1008));
    await t.test('rejects wrong protocol', () => rejectHello(url, { ...hello, protocolVersion: 999 }, 1007));
    await t.test('rejects wrong client type', () => rejectHello(url, { ...hello, client: 'foreign' }, 1007));
    await t.test('requires hello before other messages', () => rejectHello(url, { type: 'ping' }, 1008));
    await t.test('times out missing hello', () => rejectHello(url, undefined, 1008));
    assert.equal(bridge.isConnected(), false);
    for (const host of ['127.0.0.1', `127.0.0.1:${port}`, 'localhost', `localhost:${port}`, 'LOCALHOST', `[::1]:${port}`]) {
      await t.test(`accepts pinned Origin and valid token via Host ${host}`, async () => {
        const socket = new WebSocket(url, { headers: { origin, host }, handshakeTimeout: 2_000 });
        try {
          await once(socket, 'open');
          const welcome = once(socket, 'message', { signal: AbortSignal.timeout(2_000) });
          socket.send(JSON.stringify(hello));
          const [raw] = await welcome;
          assert.deepEqual(JSON.parse(raw.toString()), { type: 'welcome', protocolVersion: 2 });
          assert.equal(bridge.isConnected(clientId), true);
          const closed = once(socket, 'close');
          socket.close();
          await closed;
        } finally { socket.terminate(); }
      });
    }
  } finally { await bridge.stop(); }
});

test('bridge fails closed for missing/invalid identity and non-loopback binding', () => {
  for (const id of [undefined, '', 'test', 'q'.repeat(32), extensionId.toUpperCase()]) {
    assert.throws(() => new DshBrowserWebSocketBridge({ token, extensionId: id }), /extension ID/);
  }
  assert.throws(() => new DshBrowserWebSocketBridge({ token, extensionId, host: '0.0.0.0' }), /127\.0\.0\.1/);
});
