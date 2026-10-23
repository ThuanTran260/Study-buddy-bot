import { Client, GatewayIntentBits, Events, VoiceChannel, TextChannel } from 'discord.js';
import cron from 'node-cron';
import { env } from './config/env';
import { prisma } from './config/prisma';
import { logger } from './utils/logger';
import { monitorDiscordStartup } from './utils/discordStartupDiagnostics';
import { monitorDiscordInteractionResponses } from './utils/discordInteractionDiagnostics';
import { registerHealthClient, startHealthServer, closeHealthServer } from './utils/healthServer';
import { cleanupOldAiUsageLogs } from './services/cleanupService';
import { sendWeeklyDigestToAllUsers } from './services/weeklyDigestService';
import { sendDailyFlashcardReminder } from './services/dailyReminderService';
import {
  getAllPomodoroStates,
  removePomodoroState,
  PomodoroStateMachine,
  PomodoroStatus,
  safeSetVoiceStatus,
  activeTimers,
} from './services/pomodoroService';
import { redisClient } from './config/redis';
import * as interactionCreate from './events/interactionCreate';
import * as voiceStateUpdate from './events/voiceStateUpdate';

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection', {
    reason: String(reason),
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
    GatewayIntentBits.GuildMembers, // 🛡️ Cần thiết để lấy danh sách thành viên cho /leaderboard
  ],
});
let stopStartupDiagnostics: (() => void) | undefined;
let stopInteractionDiagnostics: (() => void) | undefined;

client.once(Events.ClientReady, async (readyClient) => {
  logger.info('Study Buddy Bot is ready', {
    tag: readyClient.user.tag,
    botUserId: readyClient.user.id,
    configuredClientId: env.clientId,
    clientIdMatches: readyClient.user.id === env.clientId,
    guilds: readyClient.guilds.cache.size,
  });

  logger.info('✅ Async Worker Queues (AI Document & AI Image) đã sẵn sàng xử lý tác vụ.');

  // Tái thiết lập các phiên Pomodoro đang chạy dở dang từ Redis
  const activeSessions = await getAllPomodoroStates();
  let resumedCount = 0;

  for (const session of activeSessions) {
    if (session.endsAt > Date.now()) {
      const remainingMs = session.endsAt - Date.now();
      const stateMachine = new PomodoroStateMachine({
        workMinutes: session.workMins,
        breakMinutes: session.breakMins,
      });

      // Cần fast-forward state machine tới đúng trạng thái
      if (session.status === PomodoroStatus.BREAK) {
        stateMachine.advancePhase(); // Lên BREAK
      }

      const channel = (await client.channels
        .fetch(session.channelId)
        .catch(() => null)) as VoiceChannel | null;
      const textChannel = (await client.channels
        .fetch(session.textChannelId)
        .catch(() => null)) as TextChannel | null;

      if (channel) {
        const timeout = setTimeout(async () => {
          const nextStatus = stateMachine.advancePhase();
          if (nextStatus === PomodoroStatus.BREAK) {
            safeSetVoiceStatus(channel, `☕ Giờ nghỉ giải lao (${session.breakMins}m)`).catch(
              () => {}
            );
            if (textChannel)
              await textChannel
                .send(`☕ Hết giờ học! Hãy nghỉ ngơi **${session.breakMins} phút** nhé.`)
                .catch(() => {});
          } else {
            safeSetVoiceStatus(channel, `🍅 Đang tập trung Pomodoro (${session.workMins}m)`).catch(
              () => {}
            );
            if (textChannel)
              await textChannel
                .send(`🍅 Hết giờ nghỉ! Bắt đầu hiệp học tiếp theo **${session.workMins} phút**.`)
                .catch(() => {});
          }
        }, remainingMs);

        activeTimers.set(session.channelId, timeout);
        resumedCount++;
      }
    } else {
      await removePomodoroState(session.channelId);
    }
  }

  if (resumedCount > 0) {
    logger.info(`Khôi phục thành công ${resumedCount} phiên Pomodoro từ Redis.`);
  }

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

  // 4. Cron Job 3: Gửi Daily Flashcard Reminder lúc 07:00 sáng VN hằng ngày
  cron.schedule(
    '0 7 * * *',
    async () => {
      try {
        await sendDailyFlashcardReminder(client);
      } catch (err) {
        logger.error('[Cron] Lỗi khi gửi Daily Flashcard Reminder:', { error: String(err) });
      }
    },
    { timezone: 'Asia/Ho_Chi_Minh' }
  );
});

client.on(Events.Error, (error) => {
  logger.error('[Discord] Client error', { error: String(error) });
});

client.on(Events.ShardError, (error, shardId) => {
  logger.error('[Discord] Gateway connection error', { shardId, error: String(error) });
});

client.on(Events.ShardDisconnect, (event, shardId) => {
  logger.warn('[Discord] Gateway disconnected', { shardId, code: event.code });
});

client.on(Events.ShardResume, (shardId, replayedEvents) => {
  logger.info('[Discord] Gateway resumed', { shardId, replayedEvents });
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
  stopStartupDiagnostics?.();
  stopInteractionDiagnostics?.();
  await closeHealthServer();
  await client.destroy();
  await prisma.$disconnect();
  await redisClient.quit().catch(() => {});
  logger.info('Cleanup complete. Bot exited cleanly.');
  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

if (process.env.NODE_ENV !== 'test') {
  // Bind HTTP before waiting for Discord or Redis recovery. Readiness stays 503 until Discord is ready.
  registerHealthClient(client);
  startHealthServer(env.healthPort);
  stopInteractionDiagnostics = monitorDiscordInteractionResponses(client);
  stopStartupDiagnostics = monitorDiscordStartup(client);
  logger.info('[Discord] Logging in', { configuredClientId: env.clientId });
  client.login(env.discordToken).catch((err) => {
    stopStartupDiagnostics?.();
    stopInteractionDiagnostics?.();
    logger.error('Discord login failed — shutting down', { error: String(err) });
    process.exit(1);
  });
}
