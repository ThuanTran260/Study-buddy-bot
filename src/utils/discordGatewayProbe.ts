export interface GatewayProbeResult {
  status?: number;
  errorCode?: string;
  durationMs: number;
}

export function probeDiscordGateway(
  token: string,
  signal?: AbortSignal
): Promise<GatewayProbeResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    let request: ClientRequest | undefined;
    let finished = false;
    const onAbort = (): void => finish({ errorCode: 'ABORTED' });
    function finish(result: Omit<GatewayProbeResult, 'durationMs'>): void {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      signal?.removeEventListener('abort', onAbort);
      request?.destroy();
      resolve({ ...result, durationMs: Date.now() - startedAt });
    }
    const deadline = setTimeout(() => finish({ errorCode: 'TIMEOUT' }), 8000);
    deadline.unref();
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      request = https.get(
        'https://discord.com/api/v10/gateway/bot',
        { family: 4, headers: { Authorization: `Bot ${token}` } },
        (response) => {
          response.destroy();
          finish({ status: response.statusCode });
        }
      );
      request.once('error', (error: NodeJS.ErrnoException) => {
        finish({ errorCode: error.code || error.name });
      });
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      finish({ errorCode: typeof code === 'string' ? code : 'REQUEST_ERROR' });
    }
  });
}
import https from 'node:https';
import type { ClientRequest } from 'node:http';
