import assert from "node:assert/strict";
import { createServer } from "node:net";
import { WebSocket } from "ws";
import { DshBrowserWebSocketBridge } from "../dist/dsh-plugin/websocket/server.js";

const token = "a".repeat(64);
const clientOne = "11111111-1111-4111-8111-111111111111";
const clientTwo = "22222222-2222-4222-8222-222222222222";

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function waitForMessage(socket, predicate, timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off("message", onMessage); reject(new Error("Timed out waiting for bridge message.")); }, timeoutMs);
    const onMessage = (data) => {
      const message = JSON.parse(data.toString());
      if (!predicate(message)) return;
      clearTimeout(timer); socket.off("message", onMessage); resolve(message);
    };
    socket.on("message", onMessage);
  });
}

async function connect(port, clientId) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { origin: "chrome-extension://test" } });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.send(JSON.stringify({ type: "hello", protocolVersion: 2, token, client: "chrome-extension", clientId }));
  await waitForMessage(socket, (message) => message.type === "welcome");
  return socket;
}

const port = await freePort();
const events = [];
const chats = [];
const disconnected = [];
const bridge = new DshBrowserWebSocketBridge({
  token,
  port,
  onExtensionEvent: (clientId, event) => events.push({ clientId, event }),
  onClientDisconnect: (clientId) => disconnected.push(clientId),
  onChat: async (clientId, text) => {
    chats.push({ clientId, text });
    return `reply:${clientId}`;
  },
});

await bridge.start();
const first = await connect(port, clientOne);
const second = await connect(port, clientTwo);
assert.equal(bridge.isConnected(clientOne), true);
assert.equal(bridge.isConnected(clientTwo), true);

const firstResponse = waitForMessage(first, (message) => message.type === "chat_response");
const secondResponse = waitForMessage(second, (message) => message.type === "chat_response");
first.send(JSON.stringify({ type: "chat", id: "chat-1", text: "one", sessionId: "session", resume: false }));
second.send(JSON.stringify({ type: "chat", id: "chat-2", text: "two", sessionId: "session", resume: false }));
assert.deepEqual(await firstResponse, { type: "chat_response", id: "chat-1", text: `reply:${clientOne}` });
assert.deepEqual(await secondResponse, { type: "chat_response", id: "chat-2", text: `reply:${clientTwo}` });
assert.deepEqual(chats, [{ clientId: clientOne, text: "one" }, { clientId: clientTwo, text: "two" }]);

bridge.sendEvent(clientOne, "only-one", { ok: true });
await waitForMessage(first, (message) => message.type === "event" && message.event === "only-one");
assert.equal(events.length, 0);

const requestResult = bridge.request(clientOne, "tabs", { requestedBy: clientOne });
const request = await waitForMessage(first, (message) => message.type === "request");
assert.equal(request.method, "tabs");
second.send(JSON.stringify({ type: "response", id: request.id, result: "wrong-client" }));
await new Promise((resolve) => setTimeout(resolve, 25));
first.send(JSON.stringify({ type: "response", id: request.id, result: "right-client" }));
assert.equal(await requestResult, "right-client");

const oldFirstClose = new Promise((resolve) => first.once("close", (code) => resolve(code)));
const replacement = await connect(port, clientOne);
assert.equal(await oldFirstClose, 1012);
assert.equal(bridge.isConnected(clientTwo), true);
bridge.sendEvent(clientTwo, "still-connected", { ok: true });
await waitForMessage(second, (message) => message.type === "event" && message.event === "still-connected");

const replacementClosed = new Promise((resolve) => replacement.once("close", resolve));
replacement.close();
await replacementClosed;
const secondClosed = new Promise((resolve) => second.once("close", resolve));
second.close();
await secondClosed;
await bridge.stop();
assert.equal(disconnected.includes(clientTwo), true);
console.log("multi-client bridge routing passed");
