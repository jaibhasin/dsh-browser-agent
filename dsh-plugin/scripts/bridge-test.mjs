import { WebSocket } from "ws";

const URL = process.env.BRIDGE_URL ?? "ws://127.0.0.1:7331";
const TOKEN = process.env.BRIDGE_TOKEN;
const SESSION_ID = process.env.BRIDGE_SESSION_ID ?? "bridge-smoke";

if (!TOKEN) {
  console.error("BRIDGE_TOKEN is required.");
  process.exit(1);
}

const ws = new WebSocket(URL, { headers: { origin: "chrome-extension://abcdefghijklmnop" } });
let finished = false;
const timer = setTimeout(() => finish(2, "# timeout (60s)"), 60000);

function finish(code, message) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  if (message) console.error(message);
  ws.close();
  setTimeout(() => process.exit(code), 50).unref();
}

ws.on("open", () => {
  console.log("# open, sending hello");
  ws.send(JSON.stringify({ type: "hello", protocolVersion: 1, token: TOKEN, client: "chrome-extension" }));
});
ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  console.log("# recv:", JSON.stringify(msg).slice(0, 400));
  if (msg.type === "welcome") {
    console.log("# authenticated, sending chat");
    ws.send(JSON.stringify({ type: "chat", id: "test-1", text: "Respond with exactly one short greeting sentence.", sessionId: SESSION_ID, resume: false }));
  }
  if (msg.type === "chat_response") {
    if (msg.id !== "test-1") return finish(1, "# unexpected response ID");
    if (msg.error) return finish(1, `# bridge rejected chat: ${msg.error.code}: ${msg.error.message}`);
    console.log("# RESULT:", JSON.stringify(msg));
    finish(0);
  }
});
ws.on("error", (e) => finish(1, `# error: ${e.message}`));
ws.on("close", (code, reason) => {
  console.log("# close", code, reason.toString());
  if (!finished) finish(1, "# bridge closed before the expected response");
});
