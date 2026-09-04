import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { PROTOCOL_VERSION, type BridgeMessage, type BridgeResponse, type JsonValue, parseBridgeMessage } from "../../shared/protocol.js";

export type DshBrowserBridgeOptions = {
  token: string;
  host?: "127.0.0.1";
  port?: number;
  requestTimeoutMs?: number;
  onExtensionEvent?: (event: string, payload: JsonValue) => void;
};
type PendingRequest = { resolve: (value: JsonValue) => void; reject: (reason: Error) => void; timeout: ReturnType<typeof setTimeout> };

/** Local DSH plugin transport. Registered DSH tools can delegate to request(). */
export class DshBrowserWebSocketBridge {
  private readonly options: Required<Pick<DshBrowserBridgeOptions, "host" | "port" | "requestTimeoutMs">> & DshBrowserBridgeOptions;
  private readonly pending = new Map<string, PendingRequest>();
  private server?: WebSocketServer;
  private extension?: WebSocket;

  constructor(options: DshBrowserBridgeOptions) {
    if (options.token.length < 32) throw new Error("DSH browser bridge token must be at least 32 characters.");
    this.options = { host: "127.0.0.1", port: 7331, requestTimeoutMs: 30_000, ...options };
  }
  async start(): Promise<void> {
    if (this.server) return;
    this.server = new WebSocketServer({ host: this.options.host, port: this.options.port, perMessageDeflate: false });
    this.server.on("connection", (socket, request) => this.accept(socket, request.headers.origin));
    await new Promise<void>((resolve, reject) => { this.server?.once("listening", resolve); this.server?.once("error", reject); });
  }
  async stop(): Promise<void> {
    this.rejectAll("The DSH browser bridge stopped.");
    this.extension?.close(1001, "DSH bridge stopped"); this.extension = undefined;
    if (!this.server) return;
    const server = this.server; this.server = undefined;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  isConnected(): boolean { return this.extension?.readyState === WebSocket.OPEN; }
  async request(method: string, params: JsonValue = null): Promise<JsonValue> {
    const socket = this.extension;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("The Chrome extension is not connected.");
    const id = randomUUID();
    return new Promise<JsonValue>((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`Browser request timed out: ${method}`)); }, this.options.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ type: "request", id, method, params } satisfies BridgeMessage), (error) => {
        if (!error) return;
        clearTimeout(timeout); this.pending.delete(id); reject(error);
      });
    });
  }
  private accept(socket: WebSocket, origin: string | undefined): void {
    if (!origin?.startsWith("chrome-extension://")) { socket.close(1008, "Chrome extension origin required"); return; }
    let authenticated = false;
    const authenticationTimeout = setTimeout(() => socket.close(1008, "Authentication timed out"), 5_000);
    socket.on("message", (data, isBinary) => {
      if (isBinary) return socket.close(1003, "Text messages only");
      const message = this.parse(data.toString());
      if (!message) return socket.close(1007, "Invalid bridge message");
      if (!authenticated) {
        if (message.type !== "hello" || message.token !== this.options.token) return socket.close(1008, "Authentication failed");
        authenticated = true; clearTimeout(authenticationTimeout);
        this.extension?.close(1012, "Replaced by a new extension connection"); this.extension = socket;
        return this.send(socket, { type: "welcome", protocolVersion: PROTOCOL_VERSION });
      }
      this.handleAuthenticatedMessage(message);
    });
    socket.on("close", () => {
      clearTimeout(authenticationTimeout);
      if (this.extension === socket) { this.extension = undefined; this.rejectAll("The Chrome extension disconnected."); }
    });
  }
  private handleAuthenticatedMessage(message: BridgeMessage): void {
    if (message.type === "pong") return;
    if (message.type === "event") return this.options.onExtensionEvent?.(message.event, message.payload);
    if (message.type === "response") this.resolveRequest(message);
  }
  private resolveRequest(message: BridgeResponse): void {
    const pending = this.pending.get(message.id); if (!pending) return;
    clearTimeout(pending.timeout); this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
    else pending.resolve(message.result ?? null);
  }
  private parse(raw: string): BridgeMessage | undefined { try { return parseBridgeMessage(JSON.parse(raw)); } catch { return undefined; } }
  private send(socket: WebSocket, message: BridgeMessage): void { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
  private rejectAll(message: string): void { for (const pending of this.pending.values()) { clearTimeout(pending.timeout); pending.reject(new Error(message)); } this.pending.clear(); }
}
