import { type APIRequest, type Client, type ResponseLike, RESTEvents } from 'discord.js';
import { logger } from './logger';

/** Observe existing callback traffic; never log paths, request options, or response bodies. */
export function monitorDiscordInteractionResponses(client: Client): () => void {
  const onResponse = (request: APIRequest, response: ResponseLike): void => {
    const match = /^\/interactions\/(\d{17,20})\/[^/]+\/callback$/.exec(request.path);
    if (!match) return;
    const interactionId = match[1];
    logger.info('[Discord] Interaction callback HTTP response', {
      interactionId,
      status: response.status,
    });
    if (response.status !== 429) return;

    const retry = response.headers.get('retry-after');
    const retrySeconds = retry?.trim() ? Number(retry) : NaN;
    const scope = response.headers.get('x-ratelimit-scope');
    const global = response.headers.get('x-ratelimit-global');
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    logger.warn('[Discord] Interaction callback rate limited', {
      interactionId,
      retryAfterSeconds: Number.isFinite(retrySeconds) && retrySeconds >= 0 ? retrySeconds : null,
      scope: scope === 'user' || scope === 'global' || scope === 'shared' ? scope : 'unknown',
      global: global === 'true' ? true : global === 'false' ? false : null,
      contentType:
        contentType === 'application/json' || contentType === 'text/html' ? contentType : 'unknown',
    });
  };
  client.rest.on(RESTEvents.Response, onResponse);
  return () => {
    client.rest.off(RESTEvents.Response, onResponse);
  };
}
