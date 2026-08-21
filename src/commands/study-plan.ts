import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { prisma } from '../config/prisma';
import { generateStudyPlanAI } from '../services/aiService';
import { checkDbRateLimit, recordDbAiUsage } from '../services/dbRateLimiter';
import { recordUserActivity } from '../services/streakService';
import { logger } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('study-plan')
  .setDescription('AI Cố vấn học tập phân tích dữ liệu 14 ngày qua và lập lộ trình học tập 7 ngày tối ưu')
  .addStringOption((opt) =>
    opt
      .setName('muc_tieu')
      .setDescription('Mục tiêu học tập cụ thể của bạn trong tuần tới (ví dụ: Thi giữa kỳ Giải tích, Học 50 từ IELTS)')
      .setRequired(false)
      .setMaxLength(200)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const discordUserId = interaction.user.id;
  const userGoal = interaction.options.getString('muc_tieu')?.trim();

  const user = await prisma.user.upsert({
    where: { discordUserId },
    create: { discordUserId, username: interaction.user.username },
    update: { username: interaction.user.username },
  });

  // 1. Kiểm tra hạn mức Rate Limit (3 lần/ngày)
  const limitCheck = await checkDbRateLimit(user.id, 'AI_STUDY_PLAN');
  if (!limitCheck.allowed) {
    await interaction.reply({ content: limitCheck.message!, ephemeral: true });
    return;
  }

  await interaction.deferReply();

  try {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    // 2. Thu thập dữ liệu định lượng 14 ngày qua
    const [quizSessions, weakFlashcards, pomodoroSessions, totalDecks] = await Promise.all([
      // A. Dữ liệu Quiz
      prisma.quizSession.findMany({
        where: {
          userId: user.id,
          createdAt: { gte: fourteenDaysAgo },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          topic: true,
          totalQuestions: true,
          correctAnswers: true,
          createdAt: true,
        },
      }),

      // B. Thẻ Flashcard yếu (hay quên - EaseFactor thấp)
      prisma.flashcard.findMany({
        where: {
          deck: { userId: user.id },
          easeFactor: { lt: 2.2 },
        },
        take: 8,
        select: {
          front: true,
          easeFactor: true,
          deck: { select: { name: true } },
        },
      }),

      // C. Phiên Pomodoro tập trung
      prisma.pomodoroSession.findMany({
        where: {
          userId: user.id,
          startedAt: { gte: fourteenDaysAgo },
        },
        select: {
          workMinutes: true,
          status: true,
        },
      }),

      // D. Tổng số bộ thẻ
      prisma.flashcardDeck.count({
        where: { userId: user.id },
      }),
    ]);

    const hasNoData = quizSessions.length === 0 && weakFlashcards.length === 0 && pomodoroSessions.length === 0 && totalDecks === 0;

    if (hasNoData && !userGoal) {
      const guidanceEmbed = new EmbedBuilder()
        .setTitle('🌱 Chào Mừng Bạn Đến Với AI Study Planner!')
        .setDescription(
          `Chào **${interaction.user.username}**, hiện bạn chưa có đủ dữ liệu học tập trong 14 ngày qua để AI phân tích chuyên sâu.\n\n` +
            `💡 **Cách tích lũy dữ liệu nhanh chóng:**\n` +
            `• 📝 Làm 1 bài kiểm tra trắc nghiệm: \`/quiz chu_de: "Lập trình C++"\`\n` +
            `• 🗂️ Tạo bộ thẻ học tập tự động: \`/flashcard ai-generate chu_de: "Từ vựng IELTS"\`\n` +
            `• 📑 Nạp tài liệu bài giảng: \`/tailieu ten_bo_the: "Kinh tế vi mô"\`\n` +
            `• 🍅 Học tập tập trung: \`/pomodoro work:25 break:5\`\n\n` +
            `*(Hoặc bạn có thể gõ lại \`/study-plan muc_tieu: "Ôn thi môn Hóa"\` để AI lập kế hoạch ngay dựa trên mục tiêu của bạn!)*`
        )
        .setColor(0x5865f2);

      await interaction.editReply({ embeds: [guidanceEmbed] });
      return;
    }

    // 3. Chuẩn hóa dữ liệu thành ngữ cảnh định lượng
    const totalPomoMinutes = pomodoroSessions.reduce((sum, p) => sum + p.workMinutes, 0);
    const totalPomoHours = (totalPomoMinutes / 60).toFixed(1);

    const quizSummary = quizSessions.length > 0
      ? quizSessions
          .map((q) => {
            const pct = q.totalQuestions > 0 ? Math.round((q.correctAnswers / q.totalQuestions) * 100) : 0;
            return `• Chủ đề "${q.topic}": ${q.correctAnswers}/${q.totalQuestions} câu đúng (${pct}%)${pct < 60 ? ' ⚠️ (Cần cải thiện)' : ' ✅'}`;
          })
          .join('\n')
      : '• Chưa làm bài Quiz nào trong 14 ngày qua.';

    const flashcardSummary = weakFlashcards.length > 0
      ? weakFlashcards
          .map((f) => `• [Bộ ${f.deck.name}] "${f.front.slice(0, 40)}" (Độ nhớ EF: ${f.easeFactor})`)
          .join('\n')
      : '• Không có thẻ Flashcard nào bị đánh giá khó/quên gần đây.';

    const dataContext = `
[THÔNG TIN SINH VIÊN]
- Tên: ${interaction.user.username}
- Chuỗi Streak học tập: 🔥 ${user.streakCount} ngày liên tiếp
- Mục tiêu tuần tới: ${userGoal || 'Học tập cân bằng, củng cố các môn yếu và duy trì thói quen'}

[DỮ LIỆU ĐỊNH LƯỢNG 14 NGÀY QUA]
1. Hoạt động Quiz (${quizSessions.length} bài đã làm):
${quizSummary}

2. Điểm yếu Flashcard (${weakFlashcards.length} thẻ hay quên):
${flashcardSummary}

3. Thời gian Pomodoro tập trung:
• Tổng thời gian học: ${totalPomoHours} giờ (${pomodoroSessions.length} phiên Pomodoro)
• Tổng số bộ thẻ đang sở hữu: ${totalDecks} bộ thẻ
`.trim();

    // 4. Gọi AI suy luận và lập kế hoạch
    const planText = await generateStudyPlanAI(dataContext);

    // 5. Ghi nhận AI Usage & Cập nhật Streak
    await recordDbAiUsage(user.id, 'AI_STUDY_PLAN').catch((err) => {
      logger.warn('Failed to record study plan AI usage', { error: String(err) });
    });
    await recordUserActivity(user.discordUserId, interaction.user.username).catch(() => {});

    // 6. Trả về Discord Rich Embed
    const planEmbed = new EmbedBuilder()
      .setTitle(`📋 Lộ Trình Học Tập Cá Nhân Hóa 7 Ngày: @${interaction.user.username}`)
      .setDescription(planText.slice(0, 4000))
      .setColor(0x57f287)
      .addFields(
        {
          name: '📈 Tóm Tắt Dữ Liệu Đầu Vào',
          value: `🔥 **Streak:** ${user.streakCount} ngày | 📝 **Quiz:** ${quizSessions.length} bài | 🍅 **Tập trung:** ${totalPomoHours}h | 🗂️ **Thẻ yếu:** ${weakFlashcards.length}`,
          inline: false,
        }
      )
      .setFooter({
        text: `💡 Kế hoạch được tối ưu bởi Study Buddy AI • Còn lại: ${limitCheck.remaining - 1}/3 lượt hôm nay`,
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [planEmbed] });
  } catch (error: any) {
    logger.error('Error in /study-plan', { userId: user.id, error: String(error) });
    await interaction.editReply({
      content: '❌ Có lỗi xảy ra khi tạo kế hoạch học tập AI. Vui lòng thử lại sau ít phút.',
    });
  }
}
