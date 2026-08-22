import { logger } from '../../src/utils/logger';

describe('🛡️ Logger Security Redaction', () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('tự động che giấu các trường nhạy cảm như token, password, apiKey', () => {
    logger.info('Test log event', {
      userId: 'user-123',
      discordToken: 'MTEyMjMzNDQ1NQ.very_secret_token',
      password: 'super_secret_password',
      apiKey: 'sk-1234567890abcdef',
      nested: {
        authToken: 'bearer_token_xyz',
        normalField: 'hello',
      },
    });

    expect(consoleLogSpy).toHaveBeenCalled();
    const loggedOutput = consoleLogSpy.mock.calls[0][0];
    const parsed = JSON.parse(loggedOutput);

    expect(parsed.discordToken).toBe('[REDACTED]');
    expect(parsed.password).toBe('[REDACTED]');
    expect(parsed.apiKey).toBe('[REDACTED]');
    expect(parsed.nested.authToken).toBe('[REDACTED]');
    expect(parsed.nested.normalField).toBe('hello');
    expect(parsed.userId).toBe('user-123');
  });
});
