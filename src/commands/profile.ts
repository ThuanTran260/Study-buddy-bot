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
      .setAuthor({
        name: `Hồ Sơ Sinh Viên: ${interaction.user.username}`,
        iconURL: interaction.user.displayAvatarURL(),
      })
      .setTitle(`🎓 Bảng Thành Tích Cá Nhân`)
      .setDescription(
        `👑 **Danh hiệu:** ${titleBadge}\n` +
          `🔥 **Chuỗi học liên tiếp (Streak):** **${user.streakCount} ngày**`
      )
      .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
      .setColor(0x5865f2)
      .addFields(
        {
          name: '📝 Trắc Nghiệm AI (/quiz)',
          value: `• Tổng bài làm: **${totalQuizzes} bài**\n• Tổng câu hỏi: **${totalQuestions} câu**\n• Độ chính xác: **${quizAccuracy}%** (${totalCorrect}/${totalQuestions})`,
          inline: true,
        },
        {
          name: '🍅 Tập Trung (/pomodoro)',
          value: `• Tổng số phiên: **${user.pomodoroSessions.length} phiên**\n• Thời gian học: **${pomoHours} giờ** (${totalWorkMinutes} phút)`,
          inline: true,
        },
        {
          name: '🗂️ Thẻ Nhớ SM-2 (/flashcard)',
          value: `• Bộ thẻ sở hữu: **${totalDecks} bộ**\n• Tổng số thẻ: **${totalCards} thẻ**\n• Thẻ cần ôn hôm nay: ⏰ **${dueCards} thẻ**`,
          inline: false,
        },
        {
          name: '⚙️ Cài Đặt Nhắc Nhở Hàng Ngày',
          value: `${reminderStatus} *(Dùng \`/profile nhac_nho: on/off\` để thay đổi)*`,
          inline: false,
        }
      )
      .setFooter({ text: 'Study Buddy 3.0 • Giữ vững tinh thần học tập mỗi ngày!' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    logger.error('Error executing profile command', { discordUserId, error: String(error) });
    await interaction.reply({ content: '❌ Có lỗi xảy ra khi tải hồ sơ học tập.', ephemeral: true });
  }
}
