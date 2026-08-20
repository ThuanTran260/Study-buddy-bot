import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('profile')
  .setDescription('Xem hồ sơ cá nhân: Chuỗi Streak, Thống kê Quiz, Giờ Pomodoro và Flashcard');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const discordUserId = interaction.user.id;

  try {
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

    // 4. Xếp hạng danh hiệu
    let titleBadge = '🌱 Tân Binh Chăm Chỉ';
    if (user.streakCount >= 30) titleBadge = '👑 Đại Kiện Tướng Học Tập';
    else if (user.streakCount >= 14) titleBadge = '⚡ Bậc Thầy Kỷ Luật';
    else if (user.streakCount >= 7) titleBadge = '🔥 Chiến Thần Học Tập';
    else if (user.streakCount >= 3) titleBadge = '⭐ Ngôi Sao Triển Vọng';

    const embed = new EmbedBuilder()
      .setTitle(`🎓 Hồ Sơ Học Tập: ${interaction.user.username}`)
      .setThumbnail(interaction.user.displayAvatarURL())
      .setColor(0x57f287)
      .setDescription(`**Danh hiệu:** ${titleBadge}\n**Chuỗi học liên tiếp (Streak):** 🔥 **${user.streakCount} ngày**`)
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
        }
      )
      .setFooter({ text: 'Study Buddy 2.0 • Học tập thông minh mỗi ngày' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (error) {
    logger.error('Error executing /profile', { discordUserId, error: String(error) });
    await interaction.reply({ content: '❌ Có lỗi xảy ra khi tải hồ sơ cá nhân.', ephemeral: true });
  }
}
