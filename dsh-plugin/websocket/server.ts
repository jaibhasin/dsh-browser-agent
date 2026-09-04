import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { PROTOCOL_VERSION, type BridgeMessage, type BridgeResponse, type JsonValue, parseBridgeMessage } from "../../shared/protocol.js";

export type DshBrowserBridgeOptions = {
  token: string;
  host?: "127.0.0.1";
  port?: number;
  requestTimeoutMs?: number;
  onExtensionEvent?: (event: string, payload: JsonValue) => void;
  onChat?: (text: string) => Promise<string>;
  onNewSession?: () => Promise<void>;
};
type PendingRequest = { resolve: (value: JsonValue) => void; reject: (reason: Error) => void; timeout: ReturnType<typeof setTimeout>; cleanup: () => void };

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
  setChatHandler(handler: (text: string) => Promise<string>): void { this.options.onChat = handler; }
  setNewSessionHandler(handler: () => Promise<void>): void { this.options.onNewSession = handler; }
  async request(method: string, params: JsonValue = null, signal?: AbortSignal): Promise<JsonValue> {
    if (signal?.aborted) throw new Error("Browser request was cancelled.");
    const socket = this.extension;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("The Chrome extension is not connected.");
    const id = randomUUID();
    return new Promise<JsonValue>((resolve, reject) => {
      const abort = () => settle(new Error("Browser request was cancelled."));
      const cleanup = () => { clearTimeout(timeout); signal?.removeEventListener("abort", abort); };
      const settle = (error: Error) => {
        const pending = this.pending.get(id); if (!pending) return;
        this.pending.delete(id); pending.cleanup(); pending.reject(error);
      };
      const timeout = setTimeout(() => settle(new Error(`Browser request timed out: ${method}`)), this.options.requestTimeoutMs);
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(id, { resolve, reject, timeout, cleanup });
      socket.send(JSON.stringify({ type: "request", id, method, params } satisfies BridgeMessage), (error) => {
        if (!error) return;
        settle(error);
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
    void this.handleAuthenticatedMessage(message, socket);
    });
    socket.on("close", () => {
      clearTimeout(authenticationTimeout);
      if (this.extension === socket) { this.extension = undefined; this.rejectAll("The Chrome extension disconnected."); }
    });
  }
  private async handleAuthenticatedMessage(message: BridgeMessage, socket: WebSocket): Promise<void> {
    if (message.type === "pong") return;
    if (message.type === "event") return this.options.onExtensionEvent?.(message.event, message.payload);
    if (message.type === "response") this.resolveRequest(message);
    if (message.type === "chat") {
      try {
        if (!this.options.onChat) throw new Error("DSH chat is not configured.");
        this.send(socket, { type: "chat_response", id: message.id, text: await this.options.onChat(message.text) });
      } catch (error) {
        this.send(socket, { type: "chat_response", id: message.id, error: { code: "DSH_CHAT_FAILED", message: error instanceof Error ? error.message : "DSH chat failed." } });
      }
    }
    if (message.type === "new_session") {
      try {
        if (!this.options.onNewSession) throw new Error("DSH sessions are not configured.");
        await this.options.onNewSession();
        this.send(socket, { type: "new_session_response", id: message.id });
      } catch (error) {
        this.send(socket, { type: "new_session_response", id: message.id, error: { code: "DSH_NEW_SESSION_FAILED", message: error instanceof Error ? error.message : "New session failed." } });
      }
    }
  }
  private resolveRequest(message: BridgeResponse): void {
    const pending = this.pending.get(message.id); if (!pending) return;
    this.pending.delete(message.id); pending.cleanup();
    if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
    else pending.resolve(message.result ?? null);
  }
  private parse(raw: string): BridgeMessage | undefined { try { return parseBridgeMessage(JSON.parse(raw)); } catch { return undefined; } }
  private send(socket: WebSocket, message: BridgeMessage): void { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
  private rejectAll(message: string): void { for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(new Error(message)); } this.pending.clear(); }
}
