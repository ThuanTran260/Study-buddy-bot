import http from 'node:http';
import { once } from 'node:events';
import { ChatInputCommandInteraction, Client, Events, RESTEvents } from 'discord.js';
import { execute as help } from '../../src/commands/help';
import { monitorDiscordInteractionResponses } from '../../src/utils/discordInteractionDiagnostics';
import { logger } from '../../src/utils/logger';

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const interactionId = '1563073233803153438';
const privateToken = 'private-interaction-token';

describe('Discord interaction HTTP diagnostics', () => {
  let client: Client;
  let server: http.Server | undefined;
  let stop: (() => void) | undefined;

  beforeEach(() => jest.clearAllMocks());

  afterEach(async () => {
    stop?.();
    await client?.destroy();
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve()))
      );
      server = undefined;
    }
  });

  async function connect(handler: http.RequestListener): Promise<void> {
    server = http.createServer(handler);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP port');
    client = new Client({
      intents: [],
      rest: { api: `http://127.0.0.1:${address.port}`, offset: 0, retries: 0 },
    });
    stop = monitorDiscordInteractionResponses(client);
    // Callback diagnostics must survive readiness, unlike startup-only diagnostics.
    client.emit(Events.ClientReady, client as Client<true>);
  }

  function interaction(): ChatInputCommandInteraction {
    // Discord constructs this class internally; exercise its real runtime implementation.
    return Reflect.construct(ChatInputCommandInteraction, [
      client,
      {
        id: interactionId,
        application_id: '1539682002788421762',
        token: privateToken,
        type: 2,
        version: 1,
        user: { id: '752891288201986150', username: 'test', discriminator: '0', avatar: null },
        data: { id: '1539920535151181824', name: 'help', type: 1 },
        locale: 'vi',
        authorizing_integration_owners: {},
        entitlements: [],
      },
    ]) as ChatInputCommandInteraction;
  }

  it('observes the real SDK callback for /help without consuming its HTTP body', async () => {
    const bodies: unknown[] = [];
    await connect((request, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      request.on('end', () => {
        bodies.push(JSON.parse(body));
        response.writeHead(204).end();
      });
    });

    const command = interaction();
    await help(command);

    expect(command.replied).toBe(true);
    expect(bodies).toEqual([
      expect.objectContaining({
        type: 4,
        data: expect.objectContaining({ embeds: expect.any(Array) }),
      }),
    ]);
    expect(logger.info).toHaveBeenCalledWith('[Discord] Interaction callback HTTP response', {
      interactionId,
      status: 204,
    });
    expect(JSON.stringify((logger.info as jest.Mock).mock.calls)).not.toContain(privateToken);
  });

  it('exposes a 429 wait that expires the acknowledgement despite a live client', async () => {
    let calls = 0;
    let saw429!: () => void;
    const received429 = new Promise<void>((resolve) => {
      saw429 = resolve;
    });
    await connect((_request, response) => {
      calls++;
      if (calls === 1) {
        response.writeHead(429, { 'retry-after': '3.1', 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            message: 'You are being rate limited.',
            retry_after: 3.1,
            global: false,
          })
        );
      } else {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ message: 'Unknown interaction', code: 10062 }));
      }
    });
    client.rest.on(RESTEvents.Response, (_request, response) => {
      if (response.status === 429) saw429();
    });
    const command = interaction();
    // Attach the rejection handler before the SDK finishes its retry.
    const result = help(command).catch((error: unknown) => error);
    await received429;

    const repliedWhileWaiting = command.replied;
    const failure = await result;
    expect(repliedWhileWaiting).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      '[Discord] Interaction callback rate limited',
      expect.objectContaining({
        interactionId,
        retryAfterSeconds: 3.1,
        scope: 'unknown',
      })
    );
    expect(failure).toMatchObject({ code: 10062 });
    expect(calls).toBe(2);
    expect(command.replied).toBe(false);
    const logs = JSON.stringify([
      ...(logger.info as jest.Mock).mock.calls,
      ...(logger.warn as jest.Mock).mock.calls,
    ]);
    expect(logs).not.toContain(privateToken);
    expect(logs).not.toContain('Hướng Dẫn');
  });

  it('ignores unrelated routes and removes its single listener on stop', () => {
    client = new Client({ intents: [] });
    const original = client.rest.listenerCount(RESTEvents.Response);
    stop = monitorDiscordInteractionResponses(client);
    client.rest.emit(
      RESTEvents.Response,
      { path: '/users/@me', route: '/users/@me' } as never,
      { status: 200 } as never
    );
    client.rest.emit(
      RESTEvents.Response,
      { path: '/interactions/not-an-id/private/callback' } as never,
      { status: 200 } as never
    );
    expect(logger.info).not.toHaveBeenCalled();
    expect(client.rest.listenerCount(RESTEvents.Response)).toBe(original + 1);
    stop();
    expect(client.rest.listenerCount(RESTEvents.Response)).toBe(original);
  });

  it.each([
    {
      headers: {
        'retry-after': '120.5',
        'x-ratelimit-scope': 'global',
        'x-ratelimit-global': 'true',
        'content-type': 'application/json; charset=utf-8',
      },
      expected: {
        retryAfterSeconds: 120.5,
        scope: 'global',
        global: true,
        contentType: 'application/json',
      },
    },
    {
      headers: {
        'retry-after': privateToken,
        'x-ratelimit-scope': privateToken,
        'x-ratelimit-global': privateToken,
        'content-type': privateToken,
      },
      expected: { retryAfterSeconds: null, scope: 'unknown', global: null, contentType: 'unknown' },
    },
  ])('logs only allowlisted 429 header values: $expected.scope', ({ headers, expected }) => {
    client = new Client({ intents: [] });
    stop = monitorDiscordInteractionResponses(client);
    client.rest.emit(
      RESTEvents.Response,
      {
        path: `/interactions/${interactionId}/${privateToken}/callback`,
        route: `/interactions/:id/${privateToken}/callback`,
        options: { headers: { authorization: privateToken } },
        data: { body: { question: 'private-question' } },
      } as never,
      { status: 429, headers: new Headers(headers) } as never
    );
    expect(logger.warn).toHaveBeenCalledWith('[Discord] Interaction callback rate limited', {
      interactionId,
      ...expected,
    });
    const logs = JSON.stringify([
      ...(logger.info as jest.Mock).mock.calls,
      ...(logger.warn as jest.Mock).mock.calls,
    ]);
    expect(logs).not.toContain(privateToken);
    expect(logs).not.toContain('private-question');
  });
});
