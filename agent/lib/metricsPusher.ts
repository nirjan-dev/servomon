import { log } from "../../shared/lib/log.ts";

export type MetricsPusherOptions = {
  /** Full ingest URL, e.g. `${SERVER_URL}/api/metrics`. */
  url: string;
  token: string;
  /** Start-to-start spacing between pushes. */
  intervalMs: number;
  /** Per-request deadline covering connect, upload and response. */
  timeoutMs: number;
  collect: () => Promise<unknown>;
};

export type MetricsPusher = { stop(): Promise<void> };

// While a push is failing, repeat the warning at most this often.
const FAILURE_REMINDER_MS = 5 * 60_000;

/**
 * Pushes metrics on a fixed cadence without overlapping requests.
 *
 * A pooled keep-alive connection can die silently (NAT/proxy drop, Wi-Fi
 * blip). Without a deadline every later request queues on it until the
 * kernel gives up (~15 min), which the server reads as the host being down.
 * Each push therefore has a timeout, and a network failure discards the
 * connection pool so the next push dials a fresh connection.
 */
export function startMetricsPusher(options: MetricsPusherOptions): MetricsPusher {
  let client = Deno.createHttpClient({});
  let stopped = false;
  let timer: Parameters<typeof clearTimeout>[0];
  let running: Promise<void> | undefined;
  let failedAttempts = 0;
  let failingSince = 0;
  let lastReminderAt = 0;

  function resetConnections(): void {
    client.close();
    client = Deno.createHttpClient({});
  }

  function recordFailure(reason: string, fields: Record<string, unknown>): void {
    const now = Date.now();
    failedAttempts++;
    if (failedAttempts === 1) {
      failingSince = now;
      lastReminderAt = now;
      log.warn("metrics push failed", { reason, ...fields });
    } else if (now - lastReminderAt >= FAILURE_REMINDER_MS) {
      lastReminderAt = now;
      log.warn("metrics push still failing", {
        reason,
        failedAttempts,
        failingForSeconds: Math.round((now - failingSince) / 1000),
        ...fields,
      });
    } else {
      log.debug("metrics push failed", { reason, failedAttempts, ...fields });
    }
  }

  function recordSuccess(durationMs: number, bytes: number): void {
    if (failedAttempts > 0) {
      log.info("metrics push recovered", {
        failedAttempts,
        downtimeSeconds: Math.round((Date.now() - failingSince) / 1000),
      });
      failedAttempts = 0;
    }
    log.debug("metrics pushed", { durationMs, bytes });
  }

  async function pushOnce(): Promise<void> {
    let body: string;
    try {
      body = JSON.stringify(await options.collect());
    } catch (error) {
      recordFailure("collect", { error });
      return;
    }

    const startedAt = performance.now();
    let response: Response;
    try {
      response = await fetch(options.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.token}`,
        },
        body,
        client,
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (error) {
      resetConnections();
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      recordFailure(timedOut ? "timeout" : "network", { error, timeoutMs: options.timeoutMs });
      return;
    }

    if (!response.ok) {
      // Server messages are short h3 errors; cap in case a proxy returns a page.
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      recordFailure("http", { status: response.status, detail });
      return;
    }
    await response.body?.cancel();
    recordSuccess(Math.round(performance.now() - startedAt), body.length);
  }

  function schedule(delayMs: number): void {
    if (stopped) return;
    timer = setTimeout(() => {
      const startedAt = Date.now();
      running = pushOnce().finally(() => {
        running = undefined;
        schedule(Math.max(0, options.intervalMs - (Date.now() - startedAt)));
      });
    }, delayMs);
  }

  schedule(options.intervalMs);

  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
      client.close();
    },
  };
}
