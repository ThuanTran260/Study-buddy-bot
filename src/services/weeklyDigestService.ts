import { Client, EmbedBuilder } from 'discord.js';
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';

export async function buildWeeklyDigestEmbed(discordUserId: string): Promise<EmbedBuilder | null> {
  const user = await prisma.user.findUnique({
    where: { discordUserId },
    include: {
      quizSessions: {
        where: {
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      },
      pomodoroSessions: {
        where: {
          startedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      },
      flashcardDecks: {
        include: {
          cards: true,
        },
      },
    },
  });

  if (!user) return null;

  const totalQuizzes = user.quizSessions.length;
  let totalQuestions = 0;
  let totalCorrect = 0;
  for (const s of user.quizSessions) {
    totalQuestions += s.totalQuestions;
    totalCorrect += s.correctAnswers;
  }
  const accuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;

  let pomodoroMinutes = 0;
  for (const p of user.pomodoroSessions) {
    pomodoroMinutes += p.workMinutes;
  }

  const now = new Date();
  let dueCards = 0;
  for (const d of user.flashcardDecks) {
    dueCards += d.cards.filter((c) => c.nextReviewAt <= now).length;
  }

  return new EmbedBuilder()
    .setTitle(`📊 Báo Cáo Học Tập Tuần: ${user.username}`)
    .setDescription(`Dưới đây là tổng kết nỗ lực học tập của bạn trong **7 ngày qua**:`)
    .setColor(0xfee75c)
    .addFields(
      { name: '🔥 Chuỗi Ngày Học (Streak)', value: `**${user.streakCount} ngày liên tiếp**`, inline: true },
      { name: '🍅 Thời Gian Pomodoro', value: `**${(pomodoroMinutes / 60).toFixed(1)} giờ** (${pomodoroMinutes}p)`, inline: true },
      { name: '📝 Bài Làm Quiz', value: `**${totalQuizzes} bài** (Chính xác: **${accuracy}%**)`, inline: true },
      { name: '🗂️ Thẻ Nhớ Cần Ôn', value: `⏰ **${dueCards} thẻ** đang chờ bạn ôn tập!`, inline: false }
    )
    .setFooter({ text: 'Chúc bạn một tuần mới học tập thật hiệu quả! • Study Buddy' })
    .setTimestamp();
}

export async function sendWeeklyDigestToAllUsers(client: Client): Promise<number> {
  let sentCount = 0;
  try {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const activeUsers = await prisma.user.findMany({
      where: {
        OR: [
          { lastActiveDate: { gte: oneWeekAgo } },
          { quizSessions: { some: { createdAt: { gte: oneWeekAgo } } } },
          { pomodoroSessions: { some: { startedAt: { gte: oneWeekAgo } } } },
        ],
      },
    });

    for (const user of activeUsers) {
      try {
        const embed = await buildWeeklyDigestEmbed(user.discordUserId);
        if (!embed) continue;

        const discordUser = await client.users.fetch(user.discordUserId).catch(() => null);
        if (discordUser) {
          await discordUser.send({ embeds: [embed], allowedMentions: { parse: [] } });
          sentCount++;
        }
      } catch (err) {
        // Bỏ qua an toàn nếu người dùng tắt DM
        logger.debug('Cannot send weekly digest DM to user', { discordUserId: user.discordUserId, err: String(err) });
      }
    }

    logger.info(`[WeeklyDigest] Đã gửi thành công báo cáo tuần tới ${sentCount} người dùng`);
  } catch (error) {
    logger.error('Error in sendWeeklyDigestToAllUsers', { error: String(error) });
  }

  return sentCount;
}
