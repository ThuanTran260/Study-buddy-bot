import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} from 'discord.js';
import { askAIWithVisualRouter } from '../services/aiService';
import { renderMermaidToBuffer, extractMermaidCode } from '../services/visualService';
import { aiImageQueue } from '../workers/imageWorker';
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
  .setDescription('Hỏi trợ lý AI học tập (tự động vẽ sơ đồ / ảnh minh họa & ghi nhớ ngữ cảnh)')
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
    const history = await getConversationHistory(discordUserId);

    // 🧠 Gọi AI với Multi-Modal Visual Router
    const aiResult = await askAIWithVisualRouter(userQuestion, history);
    const answer = aiResult.textAnswer;

    // Lưu vào bộ nhớ ngữ cảnh Redis
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

    // 📊 XỬ LÝ SƠ ĐỒ MERMAID TỰ ĐỘNG (Từ Structured Schema HOẶC Tự động bóc tách từ Text)
    const detectedMermaidCode =
      (aiResult.hasVisual && aiResult.visualType === 'mermaid' && aiResult.visualPromptOrCode)
        ? aiResult.visualPromptOrCode
        : extractMermaidCode(answer);

    if (detectedMermaidCode) {
      const mermaidBuffer = await renderMermaidToBuffer(detectedMermaidCode);

      if (mermaidBuffer) {
        logger.info('Đã render thành công sơ đồ Mermaid thành ảnh JPEG đính kèm');
        const attachment = new AttachmentBuilder(mermaidBuffer, { name: 'diagram.jpg' });
        
        // 🧹 Làm sạch khối code thô trong mô tả để chỉ hiển thị lời giải thích + Ảnh sơ đồ sắc nét
        let cleanedDescription = embedChunk
          .replace(/```mermaid[\s\S]*?```/gi, '')
          .replace(/sequenceDiagram[\s\S]+/i, '')
          .replace(/flowchart[\s\S]+/i, '')
          .replace(/📊\s*Sơ đồ học tập\s*:?/gi, '')
          .trim();

        if (!cleanedDescription) {
          cleanedDescription = 'Dưới đây là sơ đồ trực quan được tự động vẽ cho câu hỏi của bạn:';
        }

        embed.setDescription(cleanedDescription.slice(0, 4096));
        embed.setImage('attachment://diagram.jpg');

        await interaction.editReply({
          embeds: [embed],
          files: [attachment],
          allowedMentions: { parse: [] },
        });
      } else {
        // 🛡️ Multi-tier fallback về Markdown Codeblock nếu render lỗi
        const fallbackDesc = answer.includes('```mermaid')
          ? embedChunk
          : `${embedChunk}\n\n📊 **Sơ đồ học tập:**\n\`\`\`mermaid\n${detectedMermaidCode}\n\`\`\``;
        embed.setDescription(fallbackDesc.slice(0, 4096));
        await interaction.editReply({
          embeds: [embed],
          allowedMentions: { parse: [] },
        });
      }
    }
    // 🎨 XỬ LÝ SINH ẢNH IMAGEN 3 DƯỚI NỀN QUA BULLMQ
    else if (aiResult.hasVisual && aiResult.visualType === 'image' && aiResult.visualPromptOrCode) {
      const imageLimit = await checkDbRateLimit(user.id, 'AI_IMAGE_GEN');
      if (imageLimit.allowed) {
        embed.setFooter({
          text: `${contextStatus} • 🎨 Đang tạo ảnh minh họa chi tiết dưới nền...`,
        });

        await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });

        // Đẩy vào BullMQ Background Queue
        await aiImageQueue.add('generate-image', {
          userId: user.id,
          prompt: aiResult.visualPromptOrCode,
          originalQuestion: userQuestion,
          originalAnswer: answer,
          webhookToken: interaction.token,
          applicationId: interaction.client.user.id,
        });
      } else {
        await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
      }
    }
    // 🔘 CÂU HỎI THÔNG THƯỜNG -> ĐÍNH KÈM NÚT TẠO MINH HỌA THEO YÊU CẦU
    else {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`btn_visual_${interaction.id}_${discordUserId}`)
          .setLabel('🎨 Tạo Sơ đồ / Ảnh minh họa')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('✨')
      );

      await interaction.editReply({
        embeds: [embed],
        components: [row],
        allowedMentions: { parse: [] },
      });
    }

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
