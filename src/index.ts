import { Client, GatewayIntentBits, Events } from 'discord.js';
import { env } from './config/env';
import { prisma } from './config/prisma';
import { logger } from './utils/logger';
import { registerHealthClient, startHealthServer, closeHealthServer } from './utils/healthServer';
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

client.once(Events.ClientReady, (readyClient) => {
  logger.info('Study Buddy Bot is ready', { tag: readyClient.user.tag, guilds: readyClient.guilds.cache.size });
  registerHealthClient(client);
  startHealthServer(env.healthPort);
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
