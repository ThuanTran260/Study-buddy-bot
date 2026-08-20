import { SlashCommandBuilder, ChatInputCommandInteraction, VoiceChannel, GuildMember } from 'discord.js';
import { PomodoroStateMachine, PomodoroStatus, activeTimers, safeSetVoiceStatus } from '../services/pomodoroService';
import { recordUserActivity } from '../services/streakService';
import { prisma } from '../config/prisma';

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
    const timer = activeTimers.get(voiceChannel.id);
    if (timer) {
      clearTimeout(timer);
      activeTimers.delete(voiceChannel.id);
    }

    // Xóa sạch ghi chú trạng thái kênh voice
    await safeSetVoiceStatus(voiceChannel, '');

    await interaction.reply({ content: '⏹️ Đã dừng phiên Pomodoro và xóa trạng thái kênh.', ephemeral: false });
    return;
  }

  if (subcommand === 'start') {
    if (activeTimers.has(voiceChannel.id)) {
      await interaction.reply({ content: '⚠️ Voice channel này đang có một phiên Pomodoro chạy rồi.', ephemeral: true });
      return;
    }

    const workMins = interaction.options.getInteger('lam') ?? 25;
    const breakMins = interaction.options.getInteger('nghi') ?? 5;
    const stateMachine = new PomodoroStateMachine({ workMinutes: workMins, breakMinutes: breakMins });

    await interaction.deferReply();

    const userRecord = await prisma.user.upsert({
      where: { discordUserId: interaction.user.id },
      create: { discordUserId: interaction.user.id, username: interaction.user.username },
      update: { username: interaction.user.username },
    });

    const guildRecord = await prisma.guild.upsert({
      where: { discordGuildId: interaction.guildId! },
      create: { discordGuildId: interaction.guildId! },
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

    // Cập nhật chuỗi Streak học tập cho User
    await recordUserActivity(interaction.user.id, interaction.user.username);

    // Cập nhật trạng thái kênh thoại
    await safeSetVoiceStatus(voiceChannel, `🍅 Đang tập trung Pomodoro (${workMins}m)`);

    await interaction.editReply({
      content: `🍅 **Bắt đầu Pomodoro**: ${workMins} phút học, ${breakMins} phút nghỉ. Chúc bạn học tốt!\n🔥 **Chuỗi Streak học tập đã được cập nhật!**`,
    });

    const runTimer = () => {
      const timeout = setTimeout(async () => {
        const nextStatus = stateMachine.advancePhase();
        const textChannel = interaction.channel;
        if (nextStatus === PomodoroStatus.BREAK) {
          await safeSetVoiceStatus(voiceChannel, `☕ Giờ nghỉ giải lao (${breakMins}m)`);
          if (textChannel && 'send' in textChannel) {
            await (textChannel as any).send({ content: `☕ Hết giờ học! Hãy nghỉ ngơi **${breakMins} phút** nhé.` });
          }
        } else {
          await safeSetVoiceStatus(voiceChannel, `🍅 Đang tập trung Pomodoro (${workMins}m)`);
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
