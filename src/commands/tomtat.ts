import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { summarizeText } from '../services/aiService';
import { splitForEmbedAndFollowUp } from '../utils/messageSplitter';
import { checkDbRateLimit, recordDbAiUsage } from '../services/dbRateLimiter';
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('tomtat')
  .setDescription('Tóm tắt đoạn văn bản dài thành các điểm chính')
  .addStringOption((opt) =>
    opt.setName('noi_dung').setDescription('Văn bản cần tóm tắt (tối đa 4000 ký tự)').setRequired(true).setMaxLength(4000)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const user = await prisma.user.upsert({
    where: { discordUserId: interaction.user.id },
    create: { discordUserId: interaction.user.id, username: interaction.user.username },
    update: { username: interaction.user.username },
  });

  const limitResult = await checkDbRateLimit(user.id, 'AI_SUMMARIZE');
  if (!limitResult.allowed) {
    await interaction.reply({ content: limitResult.message!, ephemeral: true });
    return;
  }

  await interaction.deferReply();
  const text = interaction.options.getString('noi_dung', true);

  try {
    const summary = await summarizeText(text);
    await recordDbAiUsage(user.id, 'AI_SUMMARIZE');

    const { embedChunk, followUpChunks } = splitForEmbedAndFollowUp(summary);

    const embed = new EmbedBuilder()
      .setTitle('📝 Tóm tắt nội dung')
      .setDescription(embedChunk)
      .setColor(0x57f287)
      .setFooter({ text: `Tóm tắt bởi ${interaction.user.username} • ${text.length} ký tự gốc` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });

    for (const chunk of followUpChunks) {
      await interaction.followUp({ content: chunk, allowedMentions: { parse: [] } });
    }
  } catch (error) {
    const errorStr = (error as Error).message || String(error);
    const msg = errorStr === 'AI_TIMEOUT'
      ? '⏱️ AI mất quá nhiều thời gian phản hồi (> 25s). Vui lòng thử lại sau.'
      : '❌ Không thể tóm tắt văn bản lúc này. Vui lòng thử lại sau.';
    logger.error('Command /tomtat failed', { userId: interaction.user.id, error: String(error) });
    await interaction.editReply({ content: msg, allowedMentions: { parse: [] } });
  }
}
