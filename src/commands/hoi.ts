import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { askAI } from '../services/aiService';
import { splitForEmbedAndFollowUp } from '../utils/messageSplitter';
import { checkDbRateLimit, recordDbAiUsage } from '../services/dbRateLimiter';
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('hoi')
  .setDescription('Hỏi trợ lý AI bất kỳ câu hỏi học tập nào')
  .addStringOption((opt) =>
    opt.setName('cau_hoi').setDescription('Nội dung câu hỏi của bạn').setRequired(true).setMaxLength(1000)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const user = await prisma.user.upsert({
    where: { discordUserId: interaction.user.id },
    create: { discordUserId: interaction.user.id, username: interaction.user.username },
    update: { username: interaction.user.username },
  });

  const limitResult = await checkDbRateLimit(user.id, 'AI_QUESTION');
  if (!limitResult.allowed) {
    await interaction.reply({ content: limitResult.message!, ephemeral: true });
    return;
  }

  await interaction.deferReply();
  const question = interaction.options.getString('cau_hoi', true);

  try {
    const answer = await askAI(question);
    await recordDbAiUsage(user.id, 'AI_QUESTION');

    const { embedChunk, followUpChunks } = splitForEmbedAndFollowUp(answer);

    const embed = new EmbedBuilder()
      .setTitle('💡 Study Buddy trả lời')
      .setDescription(embedChunk)
      .setColor(0x5865f2)
      .setFooter({ text: `Hỏi bởi ${interaction.user.username}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });

    for (const chunk of followUpChunks) {
      await interaction.followUp({ content: chunk, allowedMentions: { parse: [] } });
    }
  } catch (error) {
    const errorStr = (error as Error).message || String(error);
    const msg = errorStr === 'AI_TIMEOUT'
      ? '⏱️ AI mất quá nhiều thời gian phản hồi (> 25s). Vui lòng thử lại sau.'
      : `❌ Có lỗi xảy ra khi gọi AI. Vui lòng thử lại sau.`;
    logger.error('Command /hoi failed', { userId: interaction.user.id, error: String(error) });
    await interaction.editReply({ content: msg, allowedMentions: { parse: [] } });
  }
}
