import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Xem bảng xếp hạng học tập trong máy chủ')
  .addStringOption((opt) =>
    opt
      .setName('loai')
      .setDescription('Tiêu chí xếp hạng')
      .setRequired(true)
      .addChoices(
        { name: '🔥 Chuỗi Ngày Học (Streak)', value: 'streak' },
        { name: '📝 Bài Làm Trắc Nghiệm (Quiz)', value: 'quiz' },
        { name: '🍅 Thời Gian Pomodoro', value: 'pomodoro' },
        { name: '🧠 Thẻ Nhớ Đã Thuộc (Flashcard)', value: 'flashcard' }
      )
  );

export interface LeaderboardEntry {
  discordUserId: string;
  username: string;
  score: number;
  extraText: string;
}

export async function getLeaderboardData(
  guildMemberIds: string[],
  type: 'streak' | 'quiz' | 'pomodoro' | 'flashcard'
): Promise<LeaderboardEntry[]> {
  if (guildMemberIds.length === 0) return [];

  if (type === 'streak') {
    const users = await prisma.user.findMany({
      where: {
        discordUserId: { in: guildMemberIds },
        streakCount: { gt: 0 },
      },
      orderBy: { streakCount: 'desc' },
      take: 10,
    });

    return users.map((u) => ({
      discordUserId: u.discordUserId,
      username: u.username,
      score: u.streakCount,
      extraText: `${u.streakCount} ngày liên tiếp`,
    }));
  }

  if (type === 'quiz') {
    const users = await prisma.user.findMany({
      where: {
        discordUserId: { in: guildMemberIds },
        quizSessions: { some: {} },
      },
      include: {
        quizSessions: {
          select: { totalQuestions: true, correctAnswers: true },
        },
      },
    });

    const entries: LeaderboardEntry[] = users.map((u) => {
      const totalQuizzes = u.quizSessions.length;
      let totalQuestions = 0;
      let totalCorrect = 0;
      for (const q of u.quizSessions) {
        totalQuestions += q.totalQuestions;
        totalCorrect += q.correctAnswers;
      }
      const accuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
      return {
        discordUserId: u.discordUserId,
        username: u.username,
        score: totalQuizzes,
        extraText: `${totalQuizzes} bài (Độ chính xác: ${accuracy}%)`,
      };
    });

    return entries.sort((a, b) => b.score - a.score).slice(0, 10);
  }

  if (type === 'pomodoro') {
    const users = await prisma.user.findMany({
      where: {
        discordUserId: { in: guildMemberIds },
        pomodoroSessions: { some: {} },
      },
      include: {
        pomodoroSessions: {
          select: { workMinutes: true },
        },
      },
    });

    const entries: LeaderboardEntry[] = users.map((u) => {
      let totalMinutes = 0;
      for (const p of u.pomodoroSessions) {
        totalMinutes += p.workMinutes;
      }
      const hours = (totalMinutes / 60).toFixed(1);
      return {
        discordUserId: u.discordUserId,
        username: u.username,
        score: totalMinutes,
        extraText: `${hours} giờ (${totalMinutes} phút)`,
      };
    });

    return entries.sort((a, b) => b.score - a.score).slice(0, 10);
  }

  if (type === 'flashcard') {
    const users = await prisma.user.findMany({
      where: {
        discordUserId: { in: guildMemberIds },
        flashcardDecks: { some: {} },
      },
      include: {
        flashcardDecks: {
          include: {
            cards: {
              where: { repetition: { gte: 3 } },
              select: { id: true },
            },
          },
        },
      },
    });

    const entries: LeaderboardEntry[] = users.map((u) => {
      let masteredCards = 0;
      for (const d of u.flashcardDecks) {
        masteredCards += d.cards.length;
      }
      return {
        discordUserId: u.discordUserId,
        username: u.username,
        score: masteredCards,
        extraText: `${masteredCards} thẻ thuộc lòng (repetition ≥ 3)`,
      };
    });

    return entries.sort((a, b) => b.score - a.score).slice(0, 10);
  }

  return [];
}

const MEDALS = ['🥇', '🥈', '🥉'];

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong Server.', ephemeral: true });
    return;
  }

  const type = interaction.options.getString('loai', true) as 'streak' | 'quiz' | 'pomodoro' | 'flashcard';

  await interaction.deferReply();

  try {
    // 🛡️ Lấy danh sách thành viên trong server hiện tại (Guild-Scoped Multi-Tenancy)
    let memberIds: string[] = [];
    try {
      const members = await interaction.guild.members.fetch({ limit: 1000 });
      memberIds = Array.from(members.keys());
    } catch {
      memberIds = Array.from(interaction.guild.members.cache.keys());
    }

    const leaderboard = await getLeaderboardData(memberIds, type);

    const typeTitles: Record<string, { title: string; emoji: string; color: number }> = {
      streak: { title: 'Bảng Xếp Hạng Chuỗi Ngày Học (Streak)', emoji: '🔥', color: 0xed4245 },
      quiz: { title: 'Bảng Xếp Hạng Trắc Nghiệm AI (Quiz)', emoji: '📝', color: 0x5865f2 },
      pomodoro: { title: 'Bảng Xếp Hạng Thời Gian Pomodoro', emoji: '🍅', color: 0xfee75c },
      flashcard: { title: 'Bảng Xếp Hạng Thẻ Nhớ Thuộc Lòng (SM-2)', emoji: '🧠', color: 0x57f287 },
    };

    const info = typeTitles[type];
    const embed = new EmbedBuilder()
      .setTitle(`${info.emoji} ${info.title}`)
      .setDescription(`Dưới đây là top 10 thành viên chăm chỉ nhất máy chủ **${interaction.guild.name}**:`)
      .setColor(info.color)
      .setTimestamp();

    if (leaderboard.length === 0) {
      embed.addFields({
        name: 'Chưa có dữ liệu',
        value: 'Chưa có thành viên nào ghi nhận hoạt động học tập ở hạng mục này. Hãy là người đầu tiên!',
      });
    } else {
      const lines = leaderboard.map((entry, index) => {
        const rankDisplay = index < 3 ? MEDALS[index] : `**#${index + 1}**`;
        const isCaller = entry.discordUserId === interaction.user.id;
        const userDisplay = isCaller ? `**${entry.username}** 👈 (Bạn)` : `**${entry.username}**`;
        return `${rankDisplay} ${userDisplay} — ${entry.extraText}`;
      });

      embed.addFields({ name: '🏆 Top Thành Viên', value: lines.join('\n') });
    }

    // Hiển thị vị trí của người gọi lệnh nếu có trong bảng
    const userIndex = leaderboard.findIndex((e) => e.discordUserId === interaction.user.id);
    const userRankText = userIndex !== -1 ? `Thứ hạng của bạn: #${userIndex + 1}` : 'Bạn chưa có mặt trong top 10';
    embed.setFooter({ text: `${userRankText} • Study Buddy Leaderboard` });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    logger.error('Error executing leaderboard command', { error: String(error) });
    await interaction.editReply({ content: '❌ Có lỗi xảy ra khi tải bảng xếp hạng máy chủ.' });
  }
}
