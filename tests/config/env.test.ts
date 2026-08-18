import { parseEnv } from '../../src/config/env';

describe('parseEnv', () => {
  it('throws with clear message when DISCORD_TOKEN is missing', () => {
    const invalidEnv = { DISCORD_TOKEN: '', CLIENT_ID: 'abc' };
    expect(() => parseEnv(invalidEnv)).toThrow('DISCORD_TOKEN');
  });

  it('transforms raw env vars to typed camelCase config', () => {
    const validEnv = {
      DISCORD_TOKEN: 'Bot Abc123Token',
      CLIENT_ID: '123456789012345678',
      DATABASE_URL: 'postgresql://postgres:pass@localhost:5432/studybuddy?schema=public',
      AI_API_KEY: 'sk-testkey123',
      AI_MODEL: 'gpt-4o-mini',
      HEALTH_PORT: '3000',
    };
    const config = parseEnv(validEnv);
    expect(config.discordToken).toBe('Bot Abc123Token');
    expect(config.clientId).toBe('123456789012345678');
    expect(config.databaseUrl).toContain('postgresql://');
    expect(config.aiApiKey).toBe('sk-testkey123');
    expect(config.healthPort).toBe(3000);
  });
});
