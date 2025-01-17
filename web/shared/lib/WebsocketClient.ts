export type WebsocketCallbacks = {
  onMessage?: (data: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: () => void;
};

export type WebsocketClientConfig = {
  url: string;
  maxReconnectAttempts?: number;
  reconnectInterval?: number;
} & WebsocketCallbacks;

export class WebsocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 20;
  private reconnectInterval: number = 1000;
  private reconnectTimeout?: ReturnType<typeof setTimeout>;
  private callbacks: WebsocketCallbacks = {};

  constructor(config: WebsocketClientConfig) {
    this.url = config.url;
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

  public connect(): void {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    try {
      this.ws = new WebSocket(this.url);
      this.setupEventListeners();
    } catch (error) {
      console.error("failed to create websocket connection: ", error);
      this.handleReconnect();
    }
  }

  private setupEventListeners() {
    if (!this.ws) return;

    this.ws.onopen = () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      console.log("Websocket connected");
      if (this.callbacks.onConnect) this.callbacks.onConnect();
    };

    this.ws.onclose = (event) => {
      this.isConnected = false;
      console.log(`Websocket closed: ${event.code} ${event.reason}`);
      this.handleReconnect();
      if (this.callbacks.onDisconnect) this.callbacks.onDisconnect();
    };

    this.ws.onerror = (error) => {
      console.log(`Websocket error: ${error}`);
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
      console.error(
        `Failed to reconnect after ${this.maxReconnectAttempts} attempts`
      );
      this.emit("maxReconnectAttemptsReached");
      return;
    }

    const backoffDelay = Math.min(
      this.reconnectInterval * Math.pow(2, this.reconnectAttempts), // exponential growth
      60000 // max delay of 1min
    );

    console.log(
      `attempting to reconnect in ${backoffDelay}ms... (attempt ${
        this.reconnectAttempts + 1
      })`
    );

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
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

  // Add an event emitter to notify subscribers of connection events
  private emit(event: string, data?: unknown): void {
    // We'll implement a proper event system later
    // For now, just console.log
    console.log(`Event: ${event}`, data);
  }

  protected handleMessage(data: unknown): void {
    console.log(`Received message: ${data}`);
  }

  public send(data: string): void {
    if (!this.isConnected || !this.ws) {
      throw new Error("Websocket is not connected");
    }
    this.ws.send(data);
  }
}
