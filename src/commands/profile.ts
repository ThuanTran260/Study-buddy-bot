import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('profile')
  .setDescription('Xem hồ sơ cá nhân: Chuỗi Streak, Thống kê Quiz, Giờ Pomodoro và Flashcard')
  .addStringOption((opt) =>
    opt
      .setName('nhac_nho')
      .setDescription('Bật hoặc tắt nhắc nhở ôn tập Flashcard lúc 07:00 sáng')
      .setRequired(false)
      .addChoices(
        { name: '🔔 Bật nhắc nhở (07:00 AM)', value: 'on' },
        { name: '🔕 Tắt nhắc nhở', value: 'off' }
      )
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const discordUserId = interaction.user.id;
  const reminderOption = interaction.options.getString('nhac_nho');

  try {
    // Nếu người dùng chọn đổi cấu hình nhắc nhở
    if (reminderOption) {
      const isEnabled = reminderOption === 'on';
      await prisma.user.upsert({
        where: { discordUserId },
        create: {
          discordUserId,
          username: interaction.user.username,
          dailyReminderEnabled: isEnabled,
        },
        update: {
          username: interaction.user.username,
          dailyReminderEnabled: isEnabled,
        },
      });

      const statusMsg = isEnabled
        ? '🔔 Đã **BẬT** tính năng nhắc nhở ôn tập Flashcard lúc 07:00 sáng hàng ngày.'
        : '🔕 Đã **TẮT** tính năng nhắc nhở ôn tập Flashcard hàng ngày.';

      await interaction.reply({ content: `✅ ${statusMsg}`, ephemeral: true });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { discordUserId },
      include: {
        quizSessions: true,
        pomodoroSessions: true,
        flashcardDecks: {
          include: {
            cards: true,
          },
        },
      },
    });

    if (!user) {
      await interaction.reply({
        content: '📝 Bạn chưa có dữ liệu học tập nào. Hãy bắt đầu bằng các lệnh `/quiz`, `/pomodoro` hoặc `/flashcard`!',
        ephemeral: true,
      });
      return;
    }

    // 1. Tính toán thống kê Quiz
    const totalQuizzes = user.quizSessions.length;
    let totalQuestions = 0;
    let totalCorrect = 0;
    for (const session of user.quizSessions) {
      totalQuestions += session.totalQuestions;
      totalCorrect += session.correctAnswers;
    }
    const quizAccuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;

    // 2. Tính toán thống kê Pomodoro
    let totalWorkMinutes = 0;
    for (const pomo of user.pomodoroSessions) {
      if (pomo.status === 'WORK' || pomo.status === 'BREAK') {
        totalWorkMinutes += pomo.workMinutes;
      }
    }
    const pomoHours = (totalWorkMinutes / 60).toFixed(1);

    // 3. Tính toán thống kê Flashcard
    const totalDecks = user.flashcardDecks.length;
    let totalCards = 0;
    let dueCards = 0;
    const now = new Date();
    for (const deck of user.flashcardDecks) {
      totalCards += deck.cards.length;
      dueCards += deck.cards.filter((c) => c.nextReviewAt <= now).length;
    }

    // 4. Danh hiệu theo chuỗi Streak
    let titleBadge = '🌱 Tân Binh Chăm Chỉ';
    if (user.streakCount >= 30) {
      titleBadge = '👑 Đại Kiện Tướng Học Tập';
    } else if (user.streakCount >= 14) {
      titleBadge = '⚡ Chiến Binh Kỷ Luật';
    } else if (user.streakCount >= 7) {
      titleBadge = '🔥 Ngọn Lửa Bền Bỉ';
    } else if (user.streakCount >= 3) {
      titleBadge = '⭐ Ngôi Sao Tri Thức';
    }

    const reminderStatus = user.dailyReminderEnabled ? '🔔 Đang bật (07:00 AM)' : '🔕 Đang tắt';

    const embed = new EmbedBuilder()
      .setTitle(`🎓 Hồ Sơ Học Tập: ${user.username}`)
      .setDescription(`Danh hiệu hiện tại: **${titleBadge}**`)
      .setColor(0x5865f2)
      .addFields(
        {
          name: '🔥 Chuỗi Ngày Học (Streak)',
          value: `**${user.streakCount} ngày liên tiếp**`,
          inline: true,
        },
        {
          name: '🍅 Thời Gian Pomodoro',
          value: `**${pomoHours} giờ** (${user.pomodoroSessions.length} phiên)`,
          inline: true,
        },
        {
          name: '📝 Bài Làm Quiz',
          value: `**${totalQuizzes} bài** (Độ chính xác: **${quizAccuracy}%**)`,
          inline: true,
        },
        {
          name: '🗂️ Thẻ Nhớ Flashcard (SM-2)',
          value: `📚 **${totalDecks} bộ thẻ** (${totalCards} thẻ)\n⏰ **${dueCards} thẻ** cần ôn hôm nay`,
          inline: false,
        },
        {
          name: '⚙️ Cài Đặt Nhắc Nhở',
          value: `${reminderStatus} *(Dùng \`/profile nhac_nho: on/off\` để đổi)*`,
          inline: false,
        }
      )
      .setFooter({ text: 'Study Buddy Ecosystem • Giữ vững tinh thần học tập mỗi ngày!' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    logger.error('Error executing profile command', { discordUserId, error: String(error) });
    await interaction.reply({ content: '❌ Có lỗi xảy ra khi tải hồ sơ học tập.', ephemeral: true });
  }
}
