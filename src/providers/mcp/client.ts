import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { err, ok, type Result } from '@/lib/result';
import {
  KIWI_MCP_URL,
  MCP_BACKOFF_BASE_MS,
  MCP_CALL_TIMEOUT_MS,
  MCP_CIRCUIT_FAILURE_THRESHOLD,
  MCP_CIRCUIT_OPEN_MS,
  MCP_DEFAULT_DAILY_BUDGET,
  MCP_JITTER_FRACTION,
  MCP_MAX_CONCURRENT,
  MCP_MAX_RETRIES,
  MCP_MIN_INTERVAL_MS,
} from './constants';

/**
 * A small, reusable MCP caller.
 *
 * It does the things every MCP source needs and none of them is about flights:
 * a timeout per call, retries for transient failures only, a circuit breaker,
 * a ceiling on concurrency and pace, and a daily call budget so a bug cannot
 * hammer a free server.
 *
 * The host is fixed to `KIWI_MCP_URL`. There is no way to pass another one, so
 * a request can never be steered somewhere else. The server needs no key; even
 * so, nothing here logs the arguments or the answer - only the tool name, the
 * attempt number and an error class.
 *
 * Everything with a clock or a dice roll is injectable, so tests never wait.
 */

const log = getLogger('providers.mcp.client');

export interface McpTimer {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface McpClientOptions {
  /** Builds the transport. Injected by tests; the default is Kiwi's Streamable HTTP endpoint. */
  readonly transportFactory?: () => Transport;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly backoffBaseMs?: number;
  readonly maxConcurrent?: number;
  readonly minIntervalMs?: number;
  readonly circuitFailureThreshold?: number;
  readonly circuitOpenMs?: number;
  /** Calls (attempts, not logical requests) allowed per UTC day. */
  readonly dailyBudget?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly timer?: McpTimer;
  readonly clientInfo?: { readonly name: string; readonly version: string };
}

export interface McpToolText {
  /** The text content of the answer, joined. Parsing it is the caller's job. */
  readonly text: string;
}

export interface McpClient {
  callTool(name: string, args: Record<string, unknown>): Promise<Result<McpToolText, AppError>>;
  close(): Promise<void>;
}

export const CIRCUIT_OPEN_MESSAGE = 'circuit open';

/** A failure worth trying again: the network, a timeout, a 429, a 5xx. */
export function isTransientMcpError(error: unknown): boolean {
  if (error instanceof McpTimeout) return true;
  if (error instanceof StreamableHTTPError) {
    const status = error.code;
    return status === undefined || status === 429 || status === 408 || status >= 500;
  }
  if (error instanceof AppError) return false;
  // `fetch` rejects with a TypeError for DNS, reset and refused connections.
  if (error instanceof TypeError) return true;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^(ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE)/.test(code);
}

class McpTimeout extends Error {
  constructor() {
    super('The MCP call timed out.');
    this.name = 'McpTimeout';
  }
}

const defaultTimer: McpTimer = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function defaultTransport(): Transport {
  return new StreamableHTTPClientTransport(new URL(KIWI_MCP_URL));
}

export function createMcpClient(options: McpClientOptions = {}): McpClient {
  return new KiwiMcpClient(options);
}

class KiwiMcpClient implements McpClient {
  private readonly transportFactory: () => Transport;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly maxConcurrent: number;
  private readonly minIntervalMs: number;
  private readonly failureThreshold: number;
  private readonly circuitOpenMs: number;
  private readonly dailyBudget: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly timer: McpTimer;
  private readonly clientInfo: { name: string; version: string };

  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;

  private failuresInARow = 0;
  private openUntil = 0;

  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private nextStart = 0;

  private budgetDay = '';
  private budgetUsed = 0;

  constructor(options: McpClientOptions) {
    this.transportFactory = options.transportFactory ?? defaultTransport;
    this.timeoutMs = options.timeoutMs ?? MCP_CALL_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? MCP_MAX_RETRIES;
    this.backoffBaseMs = options.backoffBaseMs ?? MCP_BACKOFF_BASE_MS;
    this.maxConcurrent = options.maxConcurrent ?? MCP_MAX_CONCURRENT;
    this.minIntervalMs = options.minIntervalMs ?? MCP_MIN_INTERVAL_MS;
    this.failureThreshold = options.circuitFailureThreshold ?? MCP_CIRCUIT_FAILURE_THRESHOLD;
    this.circuitOpenMs = options.circuitOpenMs ?? MCP_CIRCUIT_OPEN_MS;
    this.dailyBudget = options.dailyBudget ?? MCP_DEFAULT_DAILY_BUDGET;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
    this.random = options.random ?? Math.random;
    this.timer = options.timer ?? defaultTimer;
    this.clientInfo = options.clientInfo ?? { name: 'voyagr', version: '1.0.0' };
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<Result<McpToolText, AppError>> {
    if (this.now() < this.openUntil) {
      return err(new AppError('PROVIDER_UNAVAILABLE', CIRCUIT_OPEN_MESSAGE));
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (!this.spendBudget()) {
        return err(
          new AppError('RATE_LIMITED', 'The daily budget for flight data calls is used up.'),
        );
      }

      await this.acquire();
      try {
        const text = await this.callOnce(name, args);
        this.failuresInARow = 0;
        return ok({ text });
      } catch (error) {
        lastError = error;
        await this.dropConnection();
        const transient = isTransientMcpError(error);
        // Why, without secrets: the HTTP status where there is one, and the start of the
        // message. Headers and the request body are never logged.
        log.warn(
          {
            tool: name,
            attempt: attempt + 1,
            transient,
            kind: describeError(error),
            httpStatus: httpStatusOf(error),
            message: messageOf(error).slice(0, 200),
          },
          'mcp call failed',
        );
        if (!transient) break;
      } finally {
        this.release();
      }

      if (attempt < this.maxRetries) {
        const base = this.backoffBaseMs * 2 ** attempt;
        await this.sleep(base * (1 + this.random() * MCP_JITTER_FRACTION));
      }
    }

    // A tool that answered "your input is wrong" says nothing about the server's health.
    if (isTransientMcpError(lastError)) this.recordFailure();
    return err(toAppError(lastError));
  }

  async close(): Promise<void> {
    await this.dropConnection();
  }

  // --- one attempt ---------------------------------------------------------

  private async callOnce(name: string, args: Record<string, unknown>): Promise<string> {
    const client = await this.connect();
    const controller = new AbortController();
    let handle: unknown;
    const timeout = new Promise<never>((_, reject) => {
      handle = this.timer.setTimeout(() => {
        controller.abort();
        reject(new McpTimeout());
      }, this.timeoutMs);
    });

    try {
      const result = await Promise.race([
        client.callTool({ name, arguments: args }, undefined, {
          signal: controller.signal,
          // The SDK has its own clock; ours is the one that is injectable.
          timeout: this.timeoutMs + 1000,
        }),
        timeout,
      ]);

      const content = Array.isArray(result.content) ? result.content : [];
      const text = content
        .filter((part): part is { type: 'text'; text: string } => {
          return part?.type === 'text' && typeof part.text === 'string';
        })
        .map((part) => part.text)
        .join('\n');

      if (result.isError) {
        // The tool said no. Not retried, and the message is not echoed: it can quote our input.
        throw new AppError('PROVIDER_ERROR', 'The flight data server rejected the request.');
      }
      return text;
    } finally {
      this.timer.clearTimeout(handle);
    }
  }

  private connect(): Promise<Client> {
    if (this.client) return Promise.resolve(this.client);
    this.connecting ??= (async () => {
      const client = new Client(this.clientInfo, { capabilities: {} });
      await client.connect(this.transportFactory());
      this.client = client;
      return client;
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async dropConnection(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.connecting = null;
    if (!client) return;
    try {
      await client.close();
    } catch {
      // Closing a broken connection may itself fail; there is nothing left to do.
    }
  }

  // --- limits --------------------------------------------------------------

  private spendBudget(): boolean {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (day !== this.budgetDay) {
      this.budgetDay = day;
      this.budgetUsed = 0;
    }
    if (this.budgetUsed >= this.dailyBudget) return false;
    this.budgetUsed += 1;
    return true;
  }

  private async acquire(): Promise<void> {
    while (this.active >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;

    const t = this.now();
    const start = Math.max(t, this.nextStart);
    this.nextStart = start + this.minIntervalMs * (1 + this.random() * MCP_JITTER_FRACTION);
    if (start > t) await this.sleep(start - t);
  }

  private release(): void {
    this.active -= 1;
    this.waiters.shift()?.();
  }

  private recordFailure(): void {
    this.failuresInARow += 1;
    if (this.failuresInARow >= this.failureThreshold) {
      this.openUntil = this.now() + this.circuitOpenMs;
      log.warn({ openMs: this.circuitOpenMs }, 'mcp circuit opened');
    }
  }
}

function httpStatusOf(error: unknown): number | null {
  return error instanceof StreamableHTTPError && typeof error.code === 'number' ? error.code : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeError(error: unknown): string {
  if (error instanceof McpTimeout) return 'timeout';
  if (error instanceof StreamableHTTPError) return `http_${error.code ?? 'unknown'}`;
  return error instanceof Error ? error.name : 'unknown';
}

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof McpTimeout) {
    return new AppError('PROVIDER_TIMEOUT', 'The flight data server did not answer in time.');
  }
  if (error instanceof StreamableHTTPError && error.code === 429) {
    return new AppError('RATE_LIMITED', 'The flight data server is limiting requests.');
  }
  return new AppError('PROVIDER_UNAVAILABLE', 'The flight data server could not be reached.');
}
