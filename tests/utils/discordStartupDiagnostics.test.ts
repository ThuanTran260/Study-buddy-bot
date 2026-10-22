import { Client, Events, GatewayIntentBits, RESTEvents } from 'discord.js';
import { monitorDiscordStartup } from '../../src/utils/discordStartupDiagnostics';
import { logger } from '../../src/utils/logger';
import { probeDiscordGateway } from '../../src/utils/discordGatewayProbe';

jest.mock('../../src/utils/discordGatewayProbe', () => ({
  probeDiscordGateway: jest.fn().mockResolvedValue({ status: 200, durationMs: 1 }),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('Discord startup diagnostics', () => {
  let client: Client;
  let stop: () => void;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    client = new Client({ intents: [GatewayIntentBits.Guilds] });
  });

  afterEach(async () => {
    stop?.();
    await client.destroy();
    jest.useRealTimers();
  });

  it('warns once when Gateway discovery stays pending, without adding network requests', () => {
    const get = jest.spyOn(client.rest, 'get');
    stop = monitorDiscordStartup(client);

    jest.advanceTimersByTime(30_000);
    jest.advanceTimersByTime(120_000);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      '[Discord] Startup still waiting',
      expect.objectContaining({ stage: 'gateway_request', waitedMs: 30_000 })
    );
    expect(get).not.toHaveBeenCalled();
  });

  it('reports Gateway HTTP status and rate limits without logging headers or other API routes', () => {
    client.token = 'private-token';
    stop = monitorDiscordStartup(client);
    const request = {
      route: '/gateway/bot',
      options: { headers: { authorization: 'private-token' } },
    };
    client.rest.emit(
      RESTEvents.Response,
      request as never,
      { status: 429, headers: new Headers() } as never
    );
    client.rest.emit(RESTEvents.RateLimited, {
      route: '/gateway/bot',
      global: true,
      retryAfter: 60_000,
      url: 'https://discord.com/api/v10/gateway/bot?private=secret',
    } as never);
    client.rest.emit(
      RESTEvents.Response,
      { route: '/interactions/private-token/callback' } as never,
      { status: 200 } as never
    );
    jest.advanceTimersByTime(30_000);
    expect(probeDiscordGateway).not.toHaveBeenCalled();

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('[Discord] Gateway HTTP response', { status: 429 });
    expect(logger.warn).toHaveBeenCalledWith('[Discord] Gateway rate limited', {
      global: true,
      retryAfterMs: 60_000,
    });
    const output = JSON.stringify([
      ...(logger.info as jest.Mock).mock.calls,
      ...(logger.warn as jest.Mock).mock.calls,
    ]);
    expect(output).not.toContain('private-token');
    expect(output).not.toContain('secret');
  });

  it.each<{ headers: Record<string, string>; expected: Record<string, unknown> }>([
    {
      headers: {
        'retry-after': '120',
        'x-ratelimit-reset-after': '119.5',
        'x-ratelimit-scope': 'global',
        'x-ratelimit-global': 'true',
        'content-type': 'application/json; charset=utf-8',
      },
      expected: {
        retryAfterSeconds: 120,
        resetAfterSeconds: 119.5,
        scope: 'global',
        global: true,
        contentType: 'application/json',
      },
    },
    {
      headers: { 'retry-after': 'private-token', 'x-ratelimit-scope': 'private-token' },
      expected: {
        retryAfterSeconds: null,
        resetAfterSeconds: null,
        scope: 'unknown',
        global: false,
        contentType: 'unknown',
      },
    },
  ])('records safe 429 header metadata: $expected.scope', ({ headers, expected }) => {
    stop = monitorDiscordStartup(client);
    client.rest.emit(
      RESTEvents.Response,
      { route: '/gateway/bot' } as never,
      {
        status: 429,
        headers: new Headers(headers),
      } as never
    );

    expect(logger.warn).toHaveBeenCalledWith('[Discord] Gateway rate limit headers', expected);
    expect(JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toContain('private-token');
  });

  it('runs one native probe after a stalled SDK request and reports only its safe result', async () => {
    client.token = 'private-token';
    stop = monitorDiscordStartup(client);

    jest.advanceTimersByTime(30_000);
    await Promise.resolve();
    jest.advanceTimersByTime(120_000);

    expect(probeDiscordGateway).toHaveBeenCalledTimes(1);
    expect(probeDiscordGateway).toHaveBeenCalledWith('private-token', expect.any(AbortSignal));
    expect(logger.warn).toHaveBeenCalledWith('[Discord] Gateway IPv4 probe', {
      status: 200,
      durationMs: 1,
    });
  });

  it('distinguishes WebSocket connection waits and never logs raw SDK debug messages', () => {
    stop = monitorDiscordStartup(client);
    client.emit(Events.Debug, 'Provided token: private-token');
    client.emit(Events.Debug, '[WS => Manager] Fetched Gateway Information\nprivate-token');
    client.emit(
      Events.Debug,
      '[WS => Shard 0] Connecting to wss://gateway.discord.gg/?secret=private-token'
    );
    jest.advanceTimersByTime(30_000);

    expect(logger.warn).toHaveBeenCalledWith(
      '[Discord] Startup still waiting',
      expect.objectContaining({ stage: 'websocket_connecting' })
    );
    const output = JSON.stringify([
      ...(logger.info as jest.Mock).mock.calls,
      ...(logger.warn as jest.Mock).mock.calls,
    ]);
    expect(output).not.toContain('private-token');
    expect(output).not.toContain('secret');
  });

  it('cleans up its timer and listeners when Discord becomes ready', () => {
    const originalDebugListeners = client.listenerCount(Events.Debug);
    const originalResponseListeners = client.rest.listenerCount(RESTEvents.Response);
    stop = monitorDiscordStartup(client);

    client.emit(Events.ClientReady, client as Client<true>);
    jest.advanceTimersByTime(60_000);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(client.listenerCount(Events.Debug)).toBe(originalDebugListeners);
    expect(client.rest.listenerCount(RESTEvents.Response)).toBe(originalResponseListeners);
  });
});
