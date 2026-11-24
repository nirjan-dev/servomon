import { log } from "./log.ts";

export type WebsocketCallbacks = {
  onMessage?: (data: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: () => void;
};

export type WebsocketClientConfig = {
  url: string;
  /** S1: resolves a fresh single-use WS URL (with ?ticket=...) per attempt. */
  resolveUrl?: () => string | Promise<string>;
  maxReconnectAttempts?: number;
  reconnectInterval?: number;
} & WebsocketCallbacks;

export class WebsocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private resolveUrl?: () => string | Promise<string>;
  private isConnected: boolean = false;
  // An agent must keep trying for as long as it runs; outages can outlast any fixed budget.
  private maxReconnectAttempts: number = Infinity;
  private reconnectAttempts: number = 0;
  private reconnectInterval: number = 1000;
  private reconnectTimeout?: ReturnType<typeof setTimeout>;
  private lastError: unknown;
  private callbacks: WebsocketCallbacks = {};

  constructor(config: WebsocketClientConfig) {
    this.url = config.url;
    this.resolveUrl = config.resolveUrl;
    this.maxReconnectAttempts =
      config.maxReconnectAttempts ?? this.maxReconnectAttempts;
    this.reconnectInterval = config.reconnectInterval ?? this.reconnectInterval;
    this.callbacks = {
      onMessage: config.onMessage,
      onConnect: config.onConnect,
      onDisconnect: config.onDisconnect,
      onError: config.onError,
    };
  }

  public async connect(): Promise<void> {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    try {
      const url = this.resolveUrl ? await this.resolveUrl() : this.url;
      this.ws = new WebSocket(url);
      this.setupEventListeners();
    } catch (error) {
      // Warn once per outage; retries during the same outage are debug noise.
      if (this.reconnectAttempts === 0) log.warn("websocket connect failed", { error });
      else log.debug("websocket connect failed", { error, attempt: this.reconnectAttempts });
      this.handleReconnect();
    }
  }

  private setupEventListeners() {
    if (!this.ws) return;

    this.ws.onopen = () => {
      this.isConnected = true;
      log.info("websocket connected", { reconnectAttempts: this.reconnectAttempts });
      this.reconnectAttempts = 0;
      if (this.callbacks.onConnect) this.callbacks.onConnect();
    };

    this.ws.onclose = (event) => {
      this.isConnected = false;
      // onerror fires first with no useful detail of its own; report both as one event.
      const fields = { code: event.code, reason: event.reason || undefined, error: this.lastError };
      this.lastError = undefined;
      if (event.code === 1000) log.info("websocket closed", fields);
      else log.warn("websocket closed", fields);
      this.handleReconnect();
      if (this.callbacks.onDisconnect) this.callbacks.onDisconnect();
    };

    this.ws.onerror = (error) => {
      this.lastError = error;
      // NOTE: no need to call handle reconnect because onclose will be called after onerror
      if (this.callbacks.onError) this.callbacks.onError();
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data);
      if (this.callbacks.onMessage) this.callbacks.onMessage(event.data);
    };
  }

  private handleReconnect(): void {
    this.cancelReconnect();

    // don't reconnect if intentionally closed
    if (this.ws?.readyState === WebSocket.CLOSING) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      log.error("websocket reconnect attempts exhausted", { attempts: this.maxReconnectAttempts });
      return;
    }

    const backoffDelay = Math.min(
      this.reconnectInterval * Math.pow(2, this.reconnectAttempts), // exponential growth
      60000 // max delay of 1min
    );

    log.debug("websocket reconnect scheduled", {
      delayMs: backoffDelay,
      attempt: this.reconnectAttempts + 1,
    });

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++;
      void this.connect();
    }, backoffDelay);
  }

  public cancelReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }
  }

  public disconnect(): void {
    this.cancelReconnect();
    if (this.ws) {
      this.ws.close(1000, "Normal closure");
      this.ws = null;
    }
    this.isConnected = false;
  }

  // Let's also add some methods to control the reconnection behavior
  public setMaxReconnectAttempts(attempts: number): void {
    this.maxReconnectAttempts = attempts;
  }

  // Method to manually reset reconnection attempts
  public resetReconnectAttempts(): void {
    this.reconnectAttempts = 0;
  }

  protected handleMessage(data: unknown): void {
    log.debug("websocket message received", { bytes: typeof data === "string" ? data.length : undefined });
  }

  public send(data: string): void {
    if (!this.isConnected || !this.ws) {
      throw new Error("Websocket is not connected");
    }
    this.ws.send(data);
  }
}
