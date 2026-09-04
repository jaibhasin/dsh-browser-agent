import { PROTOCOL_VERSION, type BridgeChatProgress, type BridgeChatResponse, type BridgeMessage, type BridgeNewSessionResponse, type BridgeRequest, type JsonValue, parseBridgeMessage } from "../../shared/protocol";

const DEFAULT_URL = "ws://127.0.0.1:7331";
const BUILD_TOKEN = import.meta.env.VITE_DSH_BRIDGE_TOKEN ?? "";
const RECONNECT_MAX_MS = 30_000;
export type BridgeConfiguration = { url: string; token: string };
export type BridgeStatus = "disconnected" | "connecting" | "connected" | "error";
type RequestHandler = (request: BridgeRequest) => Promise<JsonValue> | JsonValue;
type ChatProgressHandler = (progress: BridgeChatProgress) => void;

export class ExtensionBridge {
  private socket?: WebSocket;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectDelayMs = 1_000;
  private status: BridgeStatus = "disconnected";
  private requestHandler?: RequestHandler;
  private chatProgressHandler?: ChatProgressHandler;
  private chatRequests = new Map<string, { resolve: (text: string) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
  private sessionRequests = new Map<string, { resolve: () => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();

  async start(): Promise<void> {
    const config = await this.getConfiguration();
    if (!config.token) return this.setStatus("disconnected");
    this.connect(config);
  }
  async configure(config: BridgeConfiguration): Promise<void> {
    const url = new URL(config.url);
    if (url.protocol !== "ws:" || !["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("The DSH bridge URL must use ws:// on localhost.");
    await chrome.storage.local.set({ dshBridge: { url: url.toString().replace(/\/$/, ""), token: config.token } });
    this.disconnect();
    await this.start();
  }
  getStatus(): BridgeStatus { return this.status; }
  setRequestHandler(handler: RequestHandler): void { this.requestHandler = handler; }
  setChatProgressHandler(handler: ChatProgressHandler): void { this.chatProgressHandler = handler; }
  chat(id: string, text: string): Promise<string> {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error("The DSH browser bridge is not connected."));
    if (!id || this.chatRequests.has(id)) return Promise.reject(new Error("The chat request ID is invalid or already in use."));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.chatRequests.delete(id); reject(new Error("DSH chat timed out.")); }, 120_000);
      this.chatRequests.set(id, { resolve, reject, timeout });
      this.send({ type: "chat", id, text });
    });
  }
  newSession(): Promise<void> {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error("The DSH browser bridge is not connected."));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.sessionRequests.delete(id); reject(new Error("New session timed out.")); }, 120_000);
      this.sessionRequests.set(id, { resolve, reject, timeout });
      this.send({ type: "new_session", id });
    });
  }
  private async getConfiguration(): Promise<BridgeConfiguration> {
    const stored = await chrome.storage.local.get("dshBridge");
    const config = stored.dshBridge as Partial<BridgeConfiguration> | undefined;
    return { url: config?.url ?? DEFAULT_URL, token: config?.token ?? BUILD_TOKEN };
  }
  private connect(config: BridgeConfiguration): void {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
    this.setStatus("connecting");
    const socket = new WebSocket(config.url);
    this.socket = socket;
    socket.addEventListener("open", () => this.send({ type: "hello", protocolVersion: PROTOCOL_VERSION, token: config.token, client: "chrome-extension" }));
    socket.addEventListener("message", (event) => this.handleMessage(event.data));
    socket.addEventListener("error", () => this.setStatus("error"));
    socket.addEventListener("close", () => {
      if (this.socket === socket) this.socket = undefined;
      if (this.status === "connected" || this.status === "connecting") this.setStatus("disconnected");
      this.scheduleReconnect();
    });
  }
  private handleMessage(data: unknown): void {
    if (typeof data !== "string") return;
    try {
      const message = parseBridgeMessage(JSON.parse(data));
      if (!message) return;
      if (message.type === "welcome") { this.reconnectDelayMs = 1_000; this.setStatus("connected"); }
      else if (message.type === "ping") this.send({ type: "pong" });
      else if (message.type === "request") void this.handleRequest(message);
      else if (message.type === "chat_progress") this.chatProgressHandler?.(message);
      else if (message.type === "chat_response") this.resolveChat(message);
      else if (message.type === "new_session_response") this.resolveNewSession(message);
    } catch { /* Invalid peer data never reaches browser automation code. */ }
  }
  private resolveChat(message: BridgeChatResponse): void {
    const pending = this.chatRequests.get(message.id); if (!pending) return;
    this.chatRequests.delete(message.id); clearTimeout(pending.timeout);
    if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
    else pending.resolve(message.text ?? "");
  }
  private resolveNewSession(message: BridgeNewSessionResponse): void {
    const pending = this.sessionRequests.get(message.id); if (!pending) return;
    this.sessionRequests.delete(message.id); clearTimeout(pending.timeout);
    if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
    else pending.resolve();
  }
  private async handleRequest(request: BridgeRequest): Promise<void> {
    try {
      if (!this.requestHandler) throw new Error("No browser request handler has been registered.");
      this.send({ type: "response", id: request.id, result: await this.requestHandler(request) });
    } catch (error) {
      this.send({ type: "response", id: request.id, error: { code: "EXTENSION_REQUEST_FAILED", message: error instanceof Error ? error.message : "Request failed." } });
    }
  }
  private send(message: BridgeMessage): void { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message)); }
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = undefined; void this.start(); }, delay);
  }
  private disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.socket?.close(); this.socket = undefined; this.setStatus("disconnected");
  }
  private setStatus(status: BridgeStatus): void {
    this.status = status;
    void chrome.runtime.sendMessage({ type: "dsh-bridge-status", status }).catch(() => undefined);
  }
}
