import 'dotenv/config';
import { z } from 'zod';

const rawEnvSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  CLIENT_ID: z.string().min(1, 'CLIENT_ID is required'),
  GUILD_ID: z.string().optional(),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  AI_PROVIDER: z.enum(['openai', 'anthropic', 'gemini']).default('openai'),
  AI_API_KEY: z.string().min(1, 'AI_API_KEY is required'),
  AI_MODEL: z.string().default('gpt-4o-mini'),
  HEALTH_PORT: z.coerce.number().default(3000),
});

export const envSchema = rawEnvSchema.transform((data) => ({
  discordToken: data.DISCORD_TOKEN,
  clientId: data.CLIENT_ID,
  guildId: data.GUILD_ID,
  databaseUrl: data.DATABASE_URL,
  aiProvider: data.AI_PROVIDER,
  aiApiKey: data.AI_API_KEY,
  aiModel: data.AI_MODEL,
  healthPort: data.HEALTH_PORT,
}));

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const missing = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`❌ Missing/invalid environment variables:\n${missing}\n\nCopy .env.example to .env and fill in the values.`);
  }
  return result.data;
}

export const env = process.env.NODE_ENV === 'test'
  ? ({
      discordToken: process.env.DISCORD_TOKEN || 'mock_token',
      clientId: process.env.CLIENT_ID || 'mock_client_id',
      guildId: process.env.GUILD_ID,
      databaseUrl: process.env.DATABASE_URL || 'postgresql://mock',
      aiProvider: 'openai' as const,
      aiApiKey: process.env.AI_API_KEY || 'mock_ai_key',
      aiModel: 'gpt-4o-mini',
      healthPort: 3000,
    } as Env)
  : parseEnv(process.env as Record<string, unknown>);
