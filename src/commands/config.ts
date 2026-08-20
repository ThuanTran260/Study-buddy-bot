import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Cấu hình các tính năng của bot cho server này (Dành cho Quản trị viên)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName('set-study-room')
      .setDescription('Đặt kênh voice trigger để tạo phòng học tự động')
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('Kênh voice người dùng bấm vào để tạo phòng')
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('set-log-channel')
      .setDescription('Đặt kênh text nhận log sự kiện và cảnh báo của bot')
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('Kênh text nhận thông báo admin')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('set-max-rooms')
      .setDescription('Đặt giới hạn số lượng phòng học mở cùng lúc trên server')
      .addIntegerOption((opt) =>
        opt
          .setName('so_luong')
          .setDescription('Số phòng tối đa (1 - 50)')
          .setMinValue(1)
          .setMaxValue(50)
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName('view').setDescription('Xem toàn bộ cấu hình hiện tại của server này')
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: '❌ Lệnh này chỉ có thể sử dụng trong Server.', ephemeral: true });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  try {
    if (subcommand === 'set-study-room') {
      const channel = interaction.options.getChannel('channel', true);
      await prisma.guild.upsert({
        where: { discordGuildId: guildId },
        create: {
          discordGuildId: guildId,
          studyRoomTriggerChannelId: channel.id,
        },
        update: {
          studyRoomTriggerChannelId: channel.id,
        },
      });

      await interaction.reply({
        content: `✅ Đã đặt kênh trigger tạo phòng học tự động thành: **${channel.name}** (<#${channel.id}>)`,
        ephemeral: true,
      });
      return;
    }

    if (subcommand === 'set-log-channel') {
      const channel = interaction.options.getChannel('channel', true);
      await prisma.guild.upsert({
        where: { discordGuildId: guildId },
        create: {
          discordGuildId: guildId,
          adminLogChannelId: channel.id,
        },
        update: {
          adminLogChannelId: channel.id,
        },
      });

      await interaction.reply({
        content: `✅ Đã đặt kênh nhận log cảnh báo admin thành: **${channel.name}** (<#${channel.id}>)`,
        ephemeral: true,
      });
      return;
    }

    if (subcommand === 'set-max-rooms') {
      const maxRooms = interaction.options.getInteger('so_luong', true);
      await prisma.guild.upsert({
        where: { discordGuildId: guildId },
        create: {
          discordGuildId: guildId,
          maxStudyRoomsPerGuild: maxRooms,
        },
        update: {
          maxStudyRoomsPerGuild: maxRooms,
        },
      });

      await interaction.reply({
        content: `✅ Đã cập nhật giới hạn phòng học tự động mở cùng lúc thành: **${maxRooms} phòng**`,
        ephemeral: true,
      });
      return;
    }

    if (subcommand === 'view') {
      const guildDb = await prisma.guild.findUnique({
        where: { discordGuildId: guildId },
      });

      const triggerChannel = guildDb?.studyRoomTriggerChannelId
        ? `<#${guildDb.studyRoomTriggerChannelId}>`
        : '*Chưa cấu hình*';
      const logChannel = guildDb?.adminLogChannelId
        ? `<#${guildDb.adminLogChannelId}>`
        : '*Chưa cấu hình*';
      const maxRooms = guildDb?.maxStudyRoomsPerGuild ?? 10;

      const embed = new EmbedBuilder()
        .setTitle(`⚙️ Cấu Hình Server: ${interaction.guild?.name}`)
        .setColor(0x5865f2)
        .addFields(
          { name: '🔊 Kênh Tạo Phòng Học (Trigger)', value: triggerChannel, inline: true },
          { name: '📋 Kênh Admin Log', value: logChannel, inline: true },
          { name: '🔢 Giới Hạn Phòng Học Tối Đa', value: `${maxRooms} phòng`, inline: true }
        )
        .setFooter({ text: 'Dùng /config <subcommand> để thay đổi cấu hình' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: { parse: [] } });
      return;
    }
  } catch (error) {
    logger.error('Error executing /config', { guildId, subcommand, error: String(error) });
    await interaction.reply({ content: '❌ Có lỗi xảy ra khi lưu cấu hình.', ephemeral: true });
  }
}
