import { Client, GatewayIntentBits, Events } from 'discord.js';
import cron from 'node-cron';
import { env } from './config/env';
import { prisma } from './config/prisma';
import { logger } from './utils/logger';
import { registerHealthClient, startHealthServer, closeHealthServer } from './utils/healthServer';
import { cleanupOldAiUsageLogs } from './services/cleanupService';
import { sendWeeklyDigestToAllUsers } from './services/weeklyDigestService';
import * as interactionCreate from './events/interactionCreate';
import * as voiceStateUpdate from './events/voiceStateUpdate';

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection', {
    reason: String(reason),
    promise: String(promise),
  });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.once(Events.ClientReady, async (readyClient) => {
  logger.info('Study Buddy Bot is ready', { tag: readyClient.user.tag, guilds: readyClient.guilds.cache.size });
  registerHealthClient(client);
  startHealthServer(env.healthPort);

  // 1. Chạy cleanup 1 lần lúc bot khởi động để dọn dẹp log rác tồn đọng
  await cleanupOldAiUsageLogs().catch((err) => {
    logger.error('Failed to run initial cleanup on startup', { error: String(err) });
  });

  // 2. Cron Job 1: Dọn dẹp AiUsageLog cũ hơn 24h lúc 03:00 sáng VN hằng ngày
  cron.schedule(
    '0 3 * * *',
    async () => {
      try {
        await cleanupOldAiUsageLogs();
      } catch (err) {
        logger.error('[Cron] Lỗi khi dọn dẹp AiUsageLog:', { error: String(err) });
      }
    },
    { timezone: 'Asia/Ho_Chi_Minh' }
  );

  // 3. Cron Job 2: Gửi Weekly Digest lúc 20:00 tối Chủ Nhật VN hàng tuần
  cron.schedule(
    '0 20 * * 0',
    async () => {
      try {
        await sendWeeklyDigestToAllUsers(client);
      } catch (err) {
        logger.error('[Cron] Lỗi khi gửi Weekly Digest:', { error: String(err) });
      }
    },
    { timezone: 'Asia/Ho_Chi_Minh' }
  );
});

client.on(Events.InteractionCreate, (interaction) => {
  interactionCreate.execute(interaction).catch((err) => {
    logger.error('Unhandled error in interactionCreate', { error: String(err) });
  });
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  voiceStateUpdate.execute(oldState, newState).catch((err) => {
    logger.error('Unhandled error in voiceStateUpdate', { error: String(err) });
  });
});

async function handleShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, initiating graceful shutdown...`);
  await closeHealthServer();
  client.destroy();
  await prisma.$disconnect();
  logger.info('Cleanup complete. Bot exited cleanly.');
  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

if (process.env.NODE_ENV !== 'test') {
  client.login(env.discordToken);
}
