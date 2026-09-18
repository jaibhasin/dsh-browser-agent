import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { PROTOCOL_VERSION, type BridgeChatDelta, type BridgeChatProgress, type BridgeMessage, type BridgePromptContentPart, type BridgeResponse, type BridgeSavedChats, type BridgeSavedChatsResponse, type BridgeSavedTasks, type BridgeSavedTasksResponse, type JsonValue, type TaskDraftRequest, type TaskDraftResponse, parseBridgeMessage } from "../../shared/protocol.js";

export type DshBrowserBridgeOptions = {
  token: string;
  host?: "127.0.0.1";
  port?: number;
  requestTimeoutMs?: number;
  onExtensionEvent?: (clientId: string, event: string, payload: JsonValue) => void;
  onClientDisconnect?: (clientId: string) => void;
  onChat?: (clientId: string, text: string, chatId: string, sessionId: string, resume: boolean, deniedTools?: string[], humanInTheLoop?: boolean, content?: BridgePromptContentPart[]) => Promise<string>;
  onNewSession?: (clientId: string) => Promise<void>;
  onTaskDraft?: (clientId: string, request: TaskDraftRequest) => Promise<Omit<TaskDraftResponse, "type" | "id">>;
  onSavedTasks?: (clientId: string, request: BridgeSavedTasks) => Promise<Pick<BridgeSavedTasksResponse, "initialized" | "tasks">>;
  onSavedChats?: (clientId: string, request: BridgeSavedChats) => Promise<Pick<BridgeSavedChatsResponse, "initialized" | "chats">>;
};
type ConnectedClient = { clientId: string; socket: WebSocket };
type PendingRequest = { clientId: string; resolve: (value: JsonValue) => void; reject: (reason: Error) => void; timeout: ReturnType<typeof setTimeout>; cleanup: () => void };

/** Local DSH plugin transport. Registered DSH tools can delegate to request(). */
export class DshBrowserWebSocketBridge {
  private static readonly HEARTBEAT_INTERVAL_MS = 20_000;
  private readonly options: Required<Pick<DshBrowserBridgeOptions, "host" | "port" | "requestTimeoutMs">> & DshBrowserBridgeOptions;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly clients = new Map<string, ConnectedClient>();
  private readonly clientsBySocket = new Map<WebSocket, string>();
  private server?: WebSocketServer;
  private heartbeatTimer?: ReturnType<typeof setInterval>;

  constructor(options: DshBrowserBridgeOptions) {
    if (options.token.length < 32) throw new Error("DSH browser bridge token must be at least 32 characters.");
    this.options = { host: "127.0.0.1", port: 7331, requestTimeoutMs: 30_000, ...options };
  }
  async start(): Promise<void> {
    if (this.server) return;
    this.server = new WebSocketServer({ host: this.options.host, port: this.options.port, perMessageDeflate: false });
    this.server.on("connection", (socket, request) => this.accept(socket, request.headers.origin));
    await new Promise<void>((resolve, reject) => { this.server?.once("listening", resolve); this.server?.once("error", reject); });
    this.heartbeatTimer = setInterval(() => {
      for (const client of this.clients.values()) {
        if (client.socket.readyState === WebSocket.OPEN) this.send(client.socket, { type: "ping" });
      }
    }, DshBrowserWebSocketBridge.HEARTBEAT_INTERVAL_MS);
  }
  async stop(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    this.rejectAll("The DSH browser bridge stopped.");
    for (const client of this.clients.values()) {
      this.options.onClientDisconnect?.(client.clientId);
      client.socket.close(1001, "DSH bridge stopped");
    }
    this.clients.clear();
    this.clientsBySocket.clear();
    if (!this.server) return;
    const server = this.server; this.server = undefined;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  isConnected(clientId?: string): boolean {
    if (clientId) return this.clients.get(clientId)?.socket.readyState === WebSocket.OPEN;
    return [...this.clients.values()].some((client) => client.socket.readyState === WebSocket.OPEN);
  }
  setChatHandler(handler: (clientId: string, text: string, chatId: string, sessionId: string, resume: boolean, deniedTools?: string[], humanInTheLoop?: boolean, content?: BridgePromptContentPart[]) => Promise<string>): void { this.options.onChat = handler; }
  setNewSessionHandler(handler: (clientId: string) => Promise<void>): void { this.options.onNewSession = handler; }
  setTaskDraftHandler(handler: (clientId: string, request: TaskDraftRequest) => Promise<Omit<TaskDraftResponse, "type" | "id">>): void { this.options.onTaskDraft = handler; }
  setSavedTasksHandler(handler: (clientId: string, request: BridgeSavedTasks) => Promise<Pick<BridgeSavedTasksResponse, "initialized" | "tasks">>): void { this.options.onSavedTasks = handler; }
  setSavedChatsHandler(handler: (clientId: string, request: BridgeSavedChats) => Promise<Pick<BridgeSavedChatsResponse, "initialized" | "chats">>): void { this.options.onSavedChats = handler; }
  sendChatDelta(clientId: string, delta: Omit<BridgeChatDelta, "type">): void {
    const socket = this.clients.get(clientId)?.socket;
    if (socket) this.send(socket, { type: "chat_delta", ...delta });
  }
  sendChatProgress(clientId: string, progress: Omit<BridgeChatProgress, "type">): void {
    const socket = this.clients.get(clientId)?.socket;
    if (socket) this.send(socket, { type: "chat_progress", ...progress });
  }
  sendEvent(clientId: string, event: string, payload: JsonValue): void {
    const socket = this.clients.get(clientId)?.socket;
    if (socket) this.send(socket, { type: "event", event, payload });
  }
  /**
   * Send a browser request for one chat turn.
   *
   * The task ID deliberately belongs to this individual request instead of
   * bridge-wide mutable state. Multiple DSH sessions can therefore issue
   * browser operations at the same time without one request being routed to
   * another chat's assigned tab.
   */
  async request(clientId: string, method: string, params: JsonValue = null, signal?: AbortSignal, taskId?: string): Promise<JsonValue> {
    if (signal?.aborted) throw new Error("Browser request was cancelled.");
    const socket = this.clients.get(clientId)?.socket;
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
      this.pending.set(id, { clientId, resolve, reject, timeout, cleanup });
      socket.send(JSON.stringify({ type: "request", id, method, params, ...(taskId ? { taskId } : {}) } satisfies BridgeMessage), (error) => {
        if (!error) return;
        settle(error);
      });
    });
  }
  private accept(socket: WebSocket, origin: string | undefined): void {
    if (!origin?.startsWith("chrome-extension://")) { socket.close(1008, "Chrome extension origin required"); return; }
    let authenticated = false;
    let clientId: string | undefined;
    const authenticationTimeout = setTimeout(() => socket.close(1008, "Authentication timed out"), 5_000);
    socket.on("message", (data, isBinary) => {
      if (isBinary) return socket.close(1003, "Text messages only");
      const message = this.parse(data.toString());
      if (!message) return socket.close(1007, "Invalid bridge message");
      if (!authenticated) {
        if (message.type !== "hello" || message.token !== this.options.token) return socket.close(1008, "Authentication failed");
        authenticated = true; clientId = message.clientId; clearTimeout(authenticationTimeout);
        const previous = this.clients.get(clientId);
        if (previous && previous.socket !== socket) {
          this.clients.delete(clientId);
          this.clientsBySocket.delete(previous.socket);
          this.rejectForClient(clientId, "The Chrome extension reconnected.");
          this.options.onClientDisconnect?.(clientId);
          previous.socket.close(1012, "Replaced by a newer connection");
        }
        this.clients.set(clientId, { clientId, socket });
        this.clientsBySocket.set(socket, clientId);
        return this.send(socket, { type: "welcome", protocolVersion: PROTOCOL_VERSION });
      }
      if (!clientId || this.clientsBySocket.get(socket) !== clientId) return;
      void this.handleAuthenticatedMessage(message, socket, clientId);
    });
    socket.on("close", () => {
      clearTimeout(authenticationTimeout);
      if (!clientId || this.clientsBySocket.get(socket) !== clientId) return;
      this.clientsBySocket.delete(socket);
      if (this.clients.get(clientId)?.socket !== socket) return;
      this.clients.delete(clientId);
      this.rejectForClient(clientId, "The Chrome extension disconnected.");
      this.options.onClientDisconnect?.(clientId);
    });
  }
  private async handleAuthenticatedMessage(message: BridgeMessage, socket: WebSocket, clientId: string): Promise<void> {
    if (message.type === "pong") return;
    if (message.type === "event") return this.options.onExtensionEvent?.(clientId, message.event, message.payload);
    if (message.type === "response") this.resolveRequest(message, socket, clientId);
    if (message.type === "chat") {
      try {
        if (!this.options.onChat) throw new Error("DSH chat is not configured.");
        this.send(socket, { type: "chat_response", id: message.id, text: await this.options.onChat(clientId, message.text, message.id, message.sessionId, message.resume, message.deniedTools, message.humanInTheLoop, message.content) });
      } catch (error) {
        this.send(socket, { type: "chat_response", id: message.id, error: { code: "DSH_CHAT_FAILED", message: error instanceof Error ? error.message : "DSH chat failed." } });
      }
    }
    if (message.type === "new_session") {
      try {
        if (!this.options.onNewSession) throw new Error("DSH sessions are not configured.");
        await this.options.onNewSession(clientId);
        this.send(socket, { type: "new_session_response", id: message.id });
      } catch (error) {
        this.send(socket, { type: "new_session_response", id: message.id, error: { code: "DSH_NEW_SESSION_FAILED", message: error instanceof Error ? error.message : "New session failed." } });
      }
    }
    if (message.type === "task_draft") {
      try {
        if (!this.options.onTaskDraft) throw new Error("Task setup is not configured.");
        this.send(socket, { type: "task_draft_response", id: message.id, ...(await this.options.onTaskDraft(clientId, message)) } as TaskDraftResponse);
      } catch (error) {
        this.send(socket, { type: "task_draft_response", id: message.id, status: "error", error: { code: "DSH_TASK_DRAFT_FAILED", message: error instanceof Error ? error.message : "Task setup failed." } });
      }
    }
    if (message.type === "saved_tasks") {
      try {
        if (!this.options.onSavedTasks) throw new Error("Saved task storage is not configured.");
        this.send(socket, { type: "saved_tasks_response", id: message.id, ...(await this.options.onSavedTasks(clientId, message)) });
      } catch (error) {
        this.send(socket, { type: "saved_tasks_response", id: message.id, initialized: false, tasks: [], error: { code: "DSH_SAVED_TASKS_FAILED", message: error instanceof Error ? error.message : "Saved task storage failed." } });
      }
    }
    if (message.type === "saved_chats") {
      try {
        if (!this.options.onSavedChats) throw new Error("Saved chat storage is not configured.");
        this.send(socket, { type: "saved_chats_response", id: message.id, ...(await this.options.onSavedChats(clientId, message)) });
      } catch (error) {
        this.send(socket, { type: "saved_chats_response", id: message.id, initialized: false, chats: [], error: { code: "DSH_SAVED_CHATS_FAILED", message: error instanceof Error ? error.message : "Saved chat storage failed." } });
      }
    }
  }
  private resolveRequest(message: BridgeResponse, socket: WebSocket, clientId: string): void {
    const pending = this.pending.get(message.id);
    if (!pending || pending.clientId !== clientId || this.clients.get(clientId)?.socket !== socket) return;
    this.pending.delete(message.id); pending.cleanup();
    if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
    else pending.resolve(message.result ?? null);
  }
  private parse(raw: string): BridgeMessage | undefined { try { return parseBridgeMessage(JSON.parse(raw)); } catch { return undefined; } }
  private send(socket: WebSocket, message: BridgeMessage): void { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
  private rejectForClient(clientId: string, message: string): void {
    for (const [id, pending] of this.pending) {
      if (pending.clientId !== clientId) continue;
      this.pending.delete(id); pending.cleanup(); pending.reject(new Error(message));
    }
  }
  private rejectAll(message: string): void { for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(new Error(message)); } this.pending.clear(); }
}
