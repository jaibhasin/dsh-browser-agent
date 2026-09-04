import { WebSocket } from "ws";

const URL = process.env.BRIDGE_URL ?? "ws://127.0.0.1:7331";
const TOKEN = process.env.BRIDGE_TOKEN;

if (!TOKEN) {
  console.error("BRIDGE_TOKEN is required.");
  process.exit(1);
}

const ws = new WebSocket(URL, { headers: { origin: "chrome-extension://abcdefghijklmnop" } });
let authed = false;
ws.on("open", () => {
  console.log("# open, sending hello");
  ws.send(JSON.stringify({ type: "hello", protocolVersion: 1, token: TOKEN, client: "chrome-extension" }));
});
ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  console.log("# recv:", JSON.stringify(msg).slice(0, 400));
  if (msg.type === "welcome") {
    authed = true;
    console.log("# authenticated, sending chat");
    ws.send(JSON.stringify({ type: "chat", id: "test-1", text: "Respond with exactly one short greeting sentence." }));
  }
  if (msg.type === "chat_response") {
    console.log("# RESULT:", JSON.stringify(msg));
    ws.close();
  }
});
ws.on("error", (e) => { console.error("# error", e.message); });
ws.on("close", (code, reason) => { console.log("# close", code, reason.toString()); process.exit(0); });
setTimeout(() => { console.error("# timeout (60s)"); process.exit(2); }, 60000);
