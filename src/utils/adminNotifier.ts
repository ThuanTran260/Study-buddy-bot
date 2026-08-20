import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import { prisma } from '../config/prisma';
import { logger } from './logger';

export async function sendAdminLog(
  client: Client,
  discordGuildId: string,
  embed: EmbedBuilder
): Promise<void> {
  try {
    const guildDb = await prisma.guild.findUnique({
      where: { discordGuildId },
    });

    if (!guildDb?.adminLogChannelId) return;

    const channel = await client.channels.fetch(guildDb.adminLogChannelId).catch(() => null);
    if (channel && channel.isTextBased() && 'send' in channel) {
      await (channel as TextChannel).send({
        embeds: [embed],
        allowedMentions: { parse: [] },
      });
    }
  } catch (error) {
    logger.error('Failed to send admin log', { discordGuildId, error: String(error) });
  }
}
