import http from 'http';
import { EventEmitter, once } from 'events';
import { Events } from 'discord.js';
import * as health from '../src/utils/healthServer';

const mockClient = Object.assign(new EventEmitter(), {
  ready: false,
  user: { id: 'bot-123', tag: 'Study Buddy' },
  guilds: { cache: new Map() },
  isReady: () => mockClient.ready,
  login: jest.fn(() => new Promise<string>(() => {})),
  destroy: jest.fn().mockResolvedValue(undefined),
});
let mockFinishRecovery: (sessions: []) => void;

jest.mock('discord.js', () => ({
  ...jest.requireActual('discord.js'),
  Client: jest.fn(() => mockClient),
}));
jest.mock('../src/config/env', () => ({
  env: { healthPort: 0, discordToken: 'test-token', clientId: 'bot-123' },
}));
jest.mock('../src/config/prisma', () => ({ prisma: { $disconnect: jest.fn() } }));
jest.mock('../src/config/redis', () => ({ redisClient: { quit: jest.fn() } }));
jest.mock('../src/events/interactionCreate', () => ({ execute: jest.fn() }));
jest.mock('../src/events/voiceStateUpdate', () => ({ execute: jest.fn() }));
jest.mock('../src/services/pomodoroService', () => ({
  getAllPomodoroStates: jest.fn(
    () =>
      new Promise<[]>((resolve) => {
        mockFinishRecovery = resolve;
      })
  ),
}));
jest.mock('../src/services/cleanupService', () => ({
  cleanupOldAiUsageLogs: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/weeklyDigestService', () => ({
  sendWeeklyDigestToAllUsers: jest.fn(),
}));
jest.mock('../src/services/dailyReminderService', () => ({
  sendDailyFlashcardReminder: jest.fn(),
}));
jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

it('opens HTTP before Discord login completes and stays reachable during session recovery', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const processEvents: EventEmitter = process;
  const signals = ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection'] as const;
  const originalListeners = signals.map(
    (signal) => [signal, processEvents.listeners(signal)] as const
  );
  const startServer = jest.spyOn(health, 'startHealthServer');

  try {
    // Exercise the real production entrypoint, with external dependencies held pending.
    process.env.NODE_ENV = 'production';
    await import('../src/index');

    const server: http.Server | undefined = startServer.mock.results[0]?.value;
    expect(server).toBeDefined();
    if (!server) throw new Error('Startup did not open an HTTP port');
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP listener');
    expect(address.address).toBe('0.0.0.0');

    expect(mockClient.login).toHaveBeenCalledWith('test-token');
    await expect(getHealth(address.port)).resolves.toEqual({
      status: 503,
      body: { status: 'not_ready' },
    });
    await expect(getHealth(address.port, 'HEAD')).resolves.toEqual({
      status: 503,
      body: undefined,
    });

    mockClient.ready = true;
    mockClient.emit(Events.ClientReady, mockClient);
    // Recovery remains pending: it must not delay the HTTP listener.
    await expect(getHealth(address.port)).resolves.toEqual({
      status: 200,
      body: { status: 'ok' },
    });
    await expect(getHealth(address.port, 'HEAD')).resolves.toEqual({
      status: 200,
      body: undefined,
    });

    mockFinishRecovery([]);
    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally {
    await health.closeHealthServer();
    for (const [signal, listeners] of originalListeners) {
      for (const listener of processEvents.listeners(signal)) {
        if (!listeners.includes(listener)) {
          processEvents.removeListener(signal, listener as (...args: unknown[]) => void);
        }
      }
    }
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    startServer.mockRestore();
  }
});

function getHealth(
  port: number,
  method = 'GET'
): Promise<{ status: number | undefined; body: unknown }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, path: '/health', method },
      (response) => {
        let body = '';
        response.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        response.on('end', () =>
          resolve({ status: response.statusCode, body: body ? JSON.parse(body) : undefined })
        );
      }
    );
    request.on('error', reject);
    request.setTimeout(2000, () => request.destroy(new Error('Health request timed out')));
    request.end();
  });
}
