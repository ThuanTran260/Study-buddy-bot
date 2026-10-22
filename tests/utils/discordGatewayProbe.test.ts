import https from 'node:https';
import { EventEmitter } from 'node:events';
import { probeDiscordGateway } from '../../src/utils/discordGatewayProbe';

jest.mock('node:https', () => ({ get: jest.fn() }));

describe('bounded native Discord Gateway probe', () => {
  const request = Object.assign(new EventEmitter(), { destroy: jest.fn() });
  let respond: (response: unknown) => void;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    request.removeAllListeners();
    (https.get as jest.Mock).mockImplementation((_url, _options, callback) => {
      respond = callback;
      return request;
    });
  });
  afterEach(() => jest.useRealTimers());

  it('uses authenticated IPv4 HTTPS and returns only status and duration', async () => {
    const pending = probeDiscordGateway('private-token');
    expect(https.get).toHaveBeenCalledWith(
      'https://discord.com/api/v10/gateway/bot',
      expect.objectContaining({ family: 4, headers: { Authorization: 'Bot private-token' } }),
      expect.any(Function)
    );
    const response = { statusCode: 200, destroy: jest.fn() };
    respond(response);
    const result = await pending;
    expect(result).toEqual({ status: 200, durationMs: 0 });
    expect(JSON.stringify(result)).not.toContain('private-token');
    expect(response.destroy).toHaveBeenCalled();
    expect(request.destroy).toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('terminates a stalled request after eight seconds without retrying', async () => {
    const pending = probeDiscordGateway('private-token');
    jest.advanceTimersByTime(8000);
    await expect(pending).resolves.toEqual({ errorCode: 'TIMEOUT', durationMs: 8000 });
    expect(https.get).toHaveBeenCalledTimes(1);
    expect(request.destroy).toHaveBeenCalledTimes(1);
  });

  it('records a network error code without exposing its message or token', async () => {
    const pending = probeDiscordGateway('private-token');
    request.emit(
      'error',
      Object.assign(new Error('secret private-token'), { code: 'ENETUNREACH' })
    );
    await expect(pending).resolves.toEqual({ errorCode: 'ENETUNREACH', durationMs: 0 });
  });

  it('cancels the request and deadline when startup monitoring stops', async () => {
    const controller = new AbortController();
    const pending = probeDiscordGateway('private-token', controller.signal);
    controller.abort();
    await expect(pending).resolves.toEqual({ errorCode: 'ABORTED', durationMs: 0 });
    expect(request.destroy).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
