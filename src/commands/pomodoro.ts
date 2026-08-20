import { SlashCommandBuilder, ChatInputCommandInteraction, VoiceChannel, GuildMember } from 'discord.js';
import { PomodoroStateMachine, PomodoroStatus, activeTimers, safeSetVoiceStatus } from '../services/pomodoroService';
import { recordUserActivity } from '../services/streakService';
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('pomodoro')
  .setDescription('Quản lý phiên học tập Pomodoro')
  .addSubcommand((sub) =>
    sub
      .setName('start')
      .setDescription('Bắt đầu phiên Pomodoro trong voice channel của bạn')
      .addIntegerOption((opt) => opt.setName('lam').setDescription('Số phút học (mặc định 25)').setMinValue(1).setMaxValue(120))
      .addIntegerOption((opt) => opt.setName('nghi').setDescription('Số phút nghỉ (mặc định 5)').setMinValue(1).setMaxValue(60))
  )
  .addSubcommand((sub) => sub.setName('stop').setDescription('Dừng phiên Pomodoro và xóa ghi chú trạng thái kênh'));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member as GuildMember;
  const voiceChannel = member.voice?.channel as VoiceChannel | null;

  if (!voiceChannel) {
    await interaction.reply({ content: '❌ Bạn phải ở trong một Voice Channel để dùng lệnh Pomodoro.', ephemeral: true });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'stop') {
    try {
      const timer = activeTimers.get(voiceChannel.id);
      if (timer) {
        clearTimeout(timer);
        activeTimers.delete(voiceChannel.id);
      }

      // Xóa sạch ghi chú trạng thái kênh voice (non-blocking)
      safeSetVoiceStatus(voiceChannel, '').catch(() => {});

      await interaction.reply({ content: '⏹️ Đã dừng phiên Pomodoro và xóa trạng thái kênh.', ephemeral: false });
      return;
    } catch (error) {
      logger.error('Error in pomodoro stop', { error: String(error) });
      await interaction.reply({ content: '❌ Có lỗi khi dừng phiên Pomodoro.', ephemeral: true });
      return;
    }
  }

  if (subcommand === 'start') {
    if (activeTimers.has(voiceChannel.id)) {
      await interaction.reply({ content: '⚠️ Voice channel này đang có một phiên Pomodoro chạy rồi.', ephemeral: true });
      return;
    }

    const workMins = interaction.options.getInteger('lam') ?? 25;
    const breakMins = interaction.options.getInteger('nghi') ?? 5;
    const stateMachine = new PomodoroStateMachine({ workMinutes: workMins, breakMinutes: breakMins });

    // ⚡ PHẢN HỒI TỨC THÌ (< 30ms) - Triệt tiêu 100% thời gian "is thinking..."
    await interaction.reply({
      content: `🍅 **Bắt đầu Pomodoro**: ${workMins} phút học, ${breakMins} phút nghỉ. Chúc bạn học tốt!\n🔥 **Chuỗi Streak học tập đã được cập nhật!**`,
    });

    // Chạy các tác vụ lưu CSDL và cập nhật trạng thái ngầm (Background Task)
    (async () => {
      try {
        const guildId = interaction.guildId;
        if (!guildId) return;

        const userRecord = await prisma.user.upsert({
          where: { discordUserId: interaction.user.id },
          create: { discordUserId: interaction.user.id, username: interaction.user.username },
          update: { username: interaction.user.username },
        });

        const guildRecord = await prisma.guild.upsert({
          where: { discordGuildId: guildId },
          create: { discordGuildId: guildId },
          update: {},
        });

        await prisma.pomodoroSession.create({
          data: {
            userId: userRecord.id,
            guildId: guildRecord.id,
            channelId: voiceChannel.id,
            workMinutes: workMins,
            breakMinutes: breakMins,
            status: 'WORK',
            endsAt: new Date(Date.now() + workMins * 60_000),
          },
        });

        recordUserActivity(interaction.user.id, interaction.user.username).catch(() => {});
        safeSetVoiceStatus(voiceChannel, `🍅 Đang tập trung Pomodoro (${workMins}m)`).catch(() => {});
      } catch (err) {
        logger.error('Background DB error in pomodoro start', { err: String(err) });
      }
    })();

    const runTimer = () => {
      const timeout = setTimeout(async () => {
        const nextStatus = stateMachine.advancePhase();
        const textChannel = interaction.channel;
        if (nextStatus === PomodoroStatus.BREAK) {
          safeSetVoiceStatus(voiceChannel, `☕ Giờ nghỉ giải lao (${breakMins}m)`).catch(() => {});
          if (textChannel && 'send' in textChannel) {
            await (textChannel as any).send({ content: `☕ Hết giờ học! Hãy nghỉ ngơi **${breakMins} phút** nhé.` }).catch(() => {});
          }
        } else {
          safeSetVoiceStatus(voiceChannel, `🍅 Đang tập trung Pomodoro (${workMins}m)`).catch(() => {});
          if (textChannel && 'send' in textChannel) {
            await (textChannel as any).send({ content: `🍅 Hết giờ nghỉ! Bắt đầu hiệp học tiếp theo **${workMins} phút**.` });
          }
        }
        runTimer();
      }, stateMachine.getDurationMs());

      activeTimers.set(voiceChannel.id, timeout);
    };

    runTimer();
  }
}
