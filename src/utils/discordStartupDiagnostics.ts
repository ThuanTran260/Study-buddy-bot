import {
  Client,
  Events,
  RESTEvents,
  Status,
  APIRequest,
  ResponseLike,
  RateLimitData,
} from 'discord.js';
import { logger } from './logger';
import { probeDiscordGateway } from './discordGatewayProbe';

export function monitorDiscordStartup(client: Client): () => void {
  let stage = 'gateway_request';
  let gatewayResponseReceived = false;
  const probeAbort = new AbortController();
  const onResponse = (request: APIRequest, response: ResponseLike): void => {
    if (request.route !== '/gateway/bot') return;
    gatewayResponseReceived = true;
    logger.info('[Discord] Gateway HTTP response', { status: response.status });
  };
  const onRateLimit = (data: RateLimitData): void => {
    if (data.route !== '/gateway/bot') return;
    gatewayResponseReceived = true;
    logger.warn('[Discord] Gateway rate limited', {
      global: data.global,
      retryAfterMs: data.retryAfter,
    });
  };
  const onDebug = (message: string): void => {
    // Only log fixed stage names. SDK debug strings can contain tokens or session details.
    if (!message.startsWith('[WS =>')) return;
    if (message.includes('Fetched Gateway Information')) {
      stage = 'gateway_info_received';
    } else if (message.includes('Connecting to ')) {
      stage = 'websocket_connecting';
    } else {
      return;
    }
    logger.info('[Discord] Gateway progress', { stage });
  };

  const timeout = setTimeout(() => {
    if (!client.isReady()) {
      logger.warn('[Discord] Startup still waiting', {
        stage,
        waitedMs: 30_000,
        wsStatus: Status[client.ws.status],
        shardCount: client.ws.shards.size,
      });
      // One bounded diagnostic request only when the SDK has received no response.
      // Never add traffic while Discord has already reported a rate limit.
      if (stage === 'gateway_request' && !gatewayResponseReceived && client.token) {
        void probeDiscordGateway(client.token, probeAbort.signal).then((result) => {
          if (!probeAbort.signal.aborted)
            logger.warn('[Discord] Gateway IPv4 probe', { ...result });
        });
      }
    }
  }, 30_000);
  timeout.unref();

  function stop(): void {
    clearTimeout(timeout);
    probeAbort.abort();
    client.off(Events.Debug, onDebug);
    client.off(Events.ClientReady, stop);
    client.rest.off(RESTEvents.Response, onResponse);
    client.rest.off(RESTEvents.RateLimited, onRateLimit);
  }

  client.on(Events.Debug, onDebug);
  client.once(Events.ClientReady, stop);
  client.rest.on(RESTEvents.Response, onResponse);
  client.rest.on(RESTEvents.RateLimited, onRateLimit);
  return stop;
}
