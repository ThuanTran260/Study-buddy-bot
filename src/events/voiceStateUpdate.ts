import { Events, VoiceState, ChannelType, PermissionFlagsBits, Collection, GuildMember } from 'discord.js';
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';

const roomCreationCooldown = new Map<string, number>();
const COOLDOWN_MS = 60_000;
const pendingCreations = new Set<string>();

export const name = Events.VoiceStateUpdate;

export async function execute(oldState: VoiceState, newState: VoiceState): Promise<void> {
  const guild = newState.guild;

  // AUTO CREATE STUDY ROOM
  if (newState.channelId && newState.member) {
    const guildDb = await prisma.guild.findUnique({
      where: { discordGuildId: guild.id },
    });

    if (guildDb?.studyRoomTriggerChannelId && newState.channelId === guildDb.studyRoomTriggerChannelId) {
      const userId = newState.member.id;

      const lastCreated = roomCreationCooldown.get(userId);
      if (lastCreated && Date.now() - lastCreated < COOLDOWN_MS) {
        await newState.member.voice.setChannel(null).catch(() => {});
        return;
      }

      if (pendingCreations.has(userId)) return;
      pendingCreations.add(userId);

      try {
        const botMember = guild.members.me;
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels) || !botMember?.permissions.has(PermissionFlagsBits.MoveMembers)) {
          logger.warn('Bot lacks ManageChannels or MoveMembers permission', { guildId: guild.id });
          return;
        }

        const newChannel = await guild.channels.create({
          name: `📚 Phòng học của ${newState.member.displayName}`,
          type: ChannelType.GuildVoice,
          parent: guildDb.studyRoomCategoryId ?? newState.channel?.parent ?? undefined,
          permissionOverwrites: [
            { id: newState.member.id, allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers] },
          ],
        });

        const userRecord = await prisma.user.upsert({
          where: { discordUserId: userId },
          create: { discordUserId: userId, username: newState.member.user.username },
          update: { username: newState.member.user.username },
        });

        await prisma.studyRoom.create({
          data: {
            guildId: guildDb.id,
            channelId: newChannel.id,
            ownerId: userRecord.id,
            isActive: true,
          },
        });

        if (newState.member.voice.channelId === guildDb.studyRoomTriggerChannelId) {
          await newState.member.voice.setChannel(newChannel);
          roomCreationCooldown.set(userId, Date.now());
        } else {
          await newChannel.delete('User left before room setup');
          await prisma.studyRoom.updateMany({ where: { channelId: newChannel.id }, data: { isActive: false } });
        }
      } catch (err) {
        logger.error('Auto study room error', { error: String(err) });
      } finally {
        pendingCreations.delete(userId);
      }
    }
  }

  // CLEANUP EMPTY STUDY ROOMS
  if (oldState.channelId && oldState.channel) {
    const channel = oldState.channel;
    const roomRecord = await prisma.studyRoom.findUnique({
      where: { channelId: channel.id },
    });

    const isVoice = channel.isVoiceBased();
    if (roomRecord && roomRecord.isActive && isVoice && (channel.members as Collection<string, GuildMember>).size === 0) {
      setTimeout(async () => {
        const refreshed = guild.channels.cache.get(channel.id);
        if (refreshed && refreshed.isVoiceBased() && (refreshed.members as Collection<string, GuildMember>).size === 0) {
          await refreshed.delete('Study room empty cleanup').catch(() => {});
          await prisma.studyRoom.update({
            where: { channelId: channel.id },
            data: { isActive: false },
          }).catch(() => {});
        }
      }, 8_000);
    }
  }
}
