import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { askAIWithContext } from '../services/aiService';
import {
  getConversationHistory,
  addToConversation,
  clearConversation,
  getConversationMessageCount,
} from '../services/conversationMemory';
import { splitForEmbedAndFollowUp } from '../utils/messageSplitter';
import { checkDbRateLimit, recordDbAiUsage } from '../services/dbRateLimiter';
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('hoi')
  .setDescription('Hỏi trợ lý AI học tập (tự động ghi nhớ ngữ cảnh hội thoại)')
  .addStringOption((opt) =>
    opt.setName('cau_hoi').setDescription('Nội dung câu hỏi của bạn').setRequired(true).setMaxLength(1000)
  )
  .addBooleanOption((opt) =>
    opt
      .setName('moi')
      .setDescription('Bắt đầu cuộc trò chuyện mới (xóa ngữ cảnh các câu hỏi cũ)')
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const discordUserId = interaction.user.id;
  const isNewTopic = interaction.options.getBoolean('moi') ?? false;

  const userQuestion = interaction.options.getString('cau_hoi', true);
  const isNew = interaction.options.getBoolean('moi') ?? false;

  const user = await prisma.user.upsert({
    where: { discordUserId },
    create: { discordUserId, username: interaction.user.username },
    update: { username: interaction.user.username },
  });

  if (isNew) {
    await clearConversation(discordUserId);
  }

  const limitResult = await checkDbRateLimit(user.id, 'AI_QUESTION');
  if (!limitResult.allowed) {
    await interaction.reply({ content: limitResult.message!, ephemeral: true });
    return;
  }

  await interaction.deferReply();

  try {
    // 🧠 Lấy lịch sử hội thoại trước đó (nếu có)
    const history = await getConversationHistory(discordUserId);

    // Gọi AI với ngữ cảnh đa lượt
    const answer = await askAIWithContext(userQuestion, history);

    // Lưu câu hỏi và câu trả lời vào bộ nhớ ngắn hạn
    await addToConversation(discordUserId, 'user', userQuestion);
    await addToConversation(discordUserId, 'model', answer);

    await recordDbAiUsage(user.id, 'AI_QUESTION');

    const { embedChunk, followUpChunks } = splitForEmbedAndFollowUp(answer);
    const msgCount = Math.floor((await getConversationMessageCount(discordUserId)) / 2);

    const contextStatus =
      msgCount > 1
        ? `💬 Ngữ cảnh: ${msgCount}/5 lượt • Gõ /hoi moi:true để làm mới`
        : `💬 Cuộc hội thoại mới • Gõ /hoi moi:true để làm mới`;

    const embed = new EmbedBuilder()
      .setTitle('💡 Study Buddy trả lời')
      .setDescription(embedChunk)
      .setColor(0x5865f2)
      .setFooter({ text: `${contextStatus} • Hỏi bởi ${interaction.user.username}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });

    for (const chunk of followUpChunks) {
      await interaction.followUp({ content: chunk, allowedMentions: { parse: [] } });
    }
  } catch (error) {
    const errorStr = (error as Error).message || String(error);
    const msg =
      errorStr === 'AI_TIMEOUT'
        ? '⏱️ AI mất quá nhiều thời gian phản hồi (> 25s). Vui lòng thử lại sau.'
        : `❌ Có lỗi xảy ra khi gọi AI. Vui lòng thử lại sau.`;
    logger.error('Command /hoi failed', { userId: interaction.user.id, error: String(error) });
    await interaction.editReply({ content: msg, allowedMentions: { parse: [] } });
  }
}
