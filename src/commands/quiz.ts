import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import { generateQuizJson, parseAIJsonResponse } from '../services/aiService';
import { calculateScore, isValidQuizTopic } from '../services/quizService';
import { quizRateLimiter } from '../utils/rateLimiter';
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('quiz')
  .setDescription('Tạo bộ câu hỏi trắc nghiệm AI và bấm nút trả lời')
  .addStringOption((opt) => opt.setName('chu_de').setDescription('Chủ đề trắc nghiệm').setRequired(true).setMaxLength(200))
  .addIntegerOption((opt) => opt.setName('so_cau').setDescription('Số câu hỏi (1 - 5)').setMinValue(1).setMaxValue(5));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const limitResult = quizRateLimiter.check(interaction.user.id);
  if (!limitResult.allowed) {
    await interaction.reply({ content: limitResult.message!, ephemeral: true });
    return;
  }

  const topic = interaction.options.getString('chu_de', true);
  const count = interaction.options.getInteger('so_cau') ?? 3;

  if (!isValidQuizTopic(topic)) {
    await interaction.reply({ content: '❌ Chủ đề không hợp lệ (độ dài 1 - 200 ký tự).', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  try {
    const rawAiJson = await generateQuizJson(topic, count);
    const questions = parseAIJsonResponse(rawAiJson);

    if (!questions || questions.length === 0) {
      await interaction.editReply({ content: '❌ AI không thể tạo bộ câu hỏi lúc này. Vui lòng thử chủ đề khác.' });
      return;
    }

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

    const session = await prisma.quizSession.create({
      data: {
        userId: userRecord.id,
        guildId: guildRecord.id,
        topic,
        totalQuestions: questions.length,
      },
    });

    let currentIndex = 0;
    let correctCount = 0;

    const sendQuestion = async (qIndex: number) => {
      const q = questions[qIndex];
      const embed = new EmbedBuilder()
        .setTitle(`📝 Quiz: ${topic} (Câu ${qIndex + 1}/${questions.length})`)
        .setDescription(`**${q.question}**\n\n` + q.options.map((o) => `**${o.label}.** ${o.text}`).join('\n'))
        .setColor(0x5865f2)
        .setFooter({ text: `Người làm: ${interaction.user.username} • Thời gian trả lời: 30s` });

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        q.options.map((opt) =>
          new ButtonBuilder()
            .setCustomId(`quiz_${opt.label}`)
            .setLabel(`${opt.label}`)
            .setStyle(ButtonStyle.Primary)
        )
      );

      const msg = await interaction.editReply({ embeds: [embed], components: [row] });

      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (i) => i.user.id === interaction.user.id,
        time: 30_000,
        max: 1,
      });

      collector.on('collect', async (btnInt) => {
        await btnInt.deferUpdate();
        const selected = btnInt.customId.replace('quiz_', '');
        const isCorrect = selected === q.correctOption;
        if (isCorrect) correctCount++;

        await prisma.quizQuestion.create({
          data: {
            quizSessionId: session.id,
            question: q.question,
            options: q.options,
            correctOption: q.correctOption,
            userAnswer: selected,
            isCorrect,
            explanation: q.explanation,
            answeredAt: new Date(),
          },
        });

        const feedbackEmbed = new EmbedBuilder()
          .setTitle(isCorrect ? '✅ Chính xác!' : '❌ Chưa chính xác!')
          .setDescription(`Đáp án đúng: **${q.correctOption}**\n*Giải thích:* ${q.explanation}`)
          .setColor(isCorrect ? 0x57f287 : 0xed4245);

        await interaction.followUp({ embeds: [feedbackEmbed], ephemeral: true });

        currentIndex++;
        if (currentIndex < questions.length) {
          await sendQuestion(currentIndex);
        } else {
          const score = calculateScore({ total: questions.length, correct: correctCount });
          await prisma.quizSession.update({
            where: { id: session.id },
            data: { correctAnswers: correctCount },
          });

          const finalEmbed = new EmbedBuilder()
            .setTitle(`🎉 Kết quả Quiz: ${topic}`)
            .setDescription(`Điểm số: **${correctCount}/${questions.length}** (${score.percentage}%)\nXếp loại: **Hạng ${score.grade}**`)
            .setColor(score.percentage >= 70 ? 0x57f287 : 0xfee75c);

          await interaction.editReply({ embeds: [finalEmbed], components: [] });
        }
      });

      collector.on('end', async (_, reason) => {
        if (reason === 'time' && currentIndex === qIndex) {
          await interaction.followUp({ content: '⏱️ Hết 30s! Câu hỏi đã bị bỏ qua.', ephemeral: true });
          currentIndex++;
          if (currentIndex < questions.length) {
            await sendQuestion(currentIndex);
          } else {
            await interaction.editReply({ components: [] });
          }
        }
      });
    };

    await sendQuestion(0);
  } catch (error) {
    logger.error('Error in /quiz', { error: String(error) });
    await interaction.editReply({ content: '❌ Có lỗi xảy ra khi tạo quiz.' });
  }
}
