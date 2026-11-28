import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

/**
 * A stand-in MCP server for tests. It speaks just enough JSON-RPC for the real SDK
 * client to connect and call a tool, and it answers each `tools/call` from a script.
 * It never opens a socket.
 */
export type FakeBehaviour =
  /** Answer with this text as the tool's text content. */
  | { readonly text: string }
  /** Fail the way the HTTP transport does for this status. */
  | { readonly http: number }
  /** Never answer, so a timeout has to end the call. */
  | { readonly hang: true }
  /** The tool reports an error of its own. */
  | { readonly toolError: true };

export class FakeMcpTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  sessionId?: string;

  constructor(private readonly behaviour: () => FakeBehaviour) {}

  async start(): Promise<void> {}

  async close(): Promise<void> {
    this.onclose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!('method' in message) || !('id' in message)) return;
    const id = message.id;

    if (message.method === 'initialize') {
      const params = message.params as { protocolVersion: string };
      this.reply({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'fake-kiwi', version: '0.0.0' },
        },
      });
      return;
    }

    if (message.method === 'tools/call') {
      const next = this.behaviour();
      if ('http' in next) throw new StreamableHTTPError(next.http, `HTTP ${next.http}`);
      if ('hang' in next) return;
      this.reply({
        jsonrpc: '2.0',
        id,
        result:
          'toolError' in next
            ? { content: [{ type: 'text', text: 'bad input' }], isError: true }
            : { content: [{ type: 'text', text: next.text }] },
      });
    }
  }

  private reply(message: JSONRPCMessage): void {
    queueMicrotask(() => this.onmessage?.(message));
  }
}

/** A transport factory whose every connection shares one script, and which counts tool calls. */
export function scriptedTransport(script: readonly FakeBehaviour[]): {
  readonly factory: () => Transport;
  readonly calls: () => number;
} {
  let calls = 0;
  const behaviour = (): FakeBehaviour => {
    const next = script[Math.min(calls, script.length - 1)]!;
    calls += 1;
    return next;
  };
  return { factory: () => new FakeMcpTransport(behaviour), calls: () => calls };
}
