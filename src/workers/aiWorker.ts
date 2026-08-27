import { AsyncWorkerQueue, QueueJob } from '../utils/asyncQueue';
import { processStudyPackIngestion } from '../services/documentService';
import { logger } from '../utils/logger';
import { EmbedBuilder, WebhookClient } from 'discord.js';

export const AI_DOCUMENT_QUEUE_NAME = 'ai-document-queue';

export interface AiDocumentJobData {
  userId: string;
  discordUserId: string;
  username: string;
  guildId: string | null;
  deckName: string;
  documentContent: string;
  truncated: boolean;
  webhookToken: string;
  applicationId: string;
}

/**
 * ⚡ Processor xử lý tài liệu nền
 */
async function processDocumentJob(job: QueueJob<AiDocumentJobData>): Promise<void> {
  logger.info(`Đang xử lý Job ${job.id} (Tài liệu của ${job.data.username})`);

  const {
    userId,
    discordUserId,
    username,
    guildId,
    deckName,
    documentContent,
    truncated,
    webhookToken,
    applicationId,
  } = job.data;

  const webhookClient = new WebhookClient({
    id: applicationId,
    token: webhookToken,
  });

  try {
    // Gọi service xử lý AI nặng
    const result = await processStudyPackIngestion(
      userId,
      discordUserId,
      username,
      guildId,
      deckName,
      documentContent
    );

    // Tạo Embed kết quả
    const embed = new EmbedBuilder()
      .setTitle(`📑 Trọn Bộ Học Tập Study Pack: "${result.deckName}"`)
      .setColor(0x57f287)
      .setTimestamp();

    let desc = `Study Buddy AI đã phân tích tài liệu của bạn và tự động khởi tạo trọn bộ công cụ học tập!\n`;
    if (truncated) {
      desc += `\n*(ℹ️ Tài liệu dài đã được cắt gọn 12.000 ký tự đầu tiên để phân tích trọng tâm)*\n`;
    }
    embed.setDescription(desc);

    embed.addFields({
      name: '📝 Tóm Tắt Luận Điểm Cốt Lõi',
      value: result.summary.slice(0, 1024),
      inline: false,
    });

    const deckStatusText = result.isAppended
      ? `Đã nạp thêm **${result.flashcardCount} thẻ mới** vào bộ thẻ có sẵn \`${result.deckName}\``
      : `Đã tạo bộ thẻ mới \`${result.deckName}\` với **${result.flashcardCount} thẻ ghi nhớ**`;

    embed.addFields({
      name: '🗂️ Thẻ Nhớ Ghi Nhớ Lâu Dài (SM-2)',
      value: `✅ ${deckStatusText}!\n💡 Gõ \`/flashcard review ten_bo_the: "${result.deckName}"\` để bắt đầu chu kỳ ôn tập.`,
      inline: false,
    });

    if (result.sampleQuiz) {
      const q = result.sampleQuiz;
      const optionsText = q.options.map((o) => `**${o.label}.** ${o.text}`).join('\n');
      embed.addFields({
        name: '🎯 Câu Hỏi Tự Đánh Giá Mẫu',
        value: `**${q.question}**\n${optionsText}\n*(Đáp án đúng: **${q.correctOption}** — ${q.explanation})*`,
        inline: false,
      });
    }

    await webhookClient.editMessage('@original', { content: '', embeds: [embed] });
    logger.info(`Job ${job.id} hoàn thành.`);
  } catch (error: unknown) {
    logger.error(`Job ${job.id} thất bại`, { error: String(error) });
    let userFriendlyMsg = '❌ Có lỗi xảy ra khi xử lý tài liệu học tập (Background Job).';
    const errorMsg = error instanceof Error && error.message ? error.message : String(error);

    if (errorMsg === 'AI_TIMEOUT') {
      userFriendlyMsg = '⏱️ AI mất quá nhiều thời gian phản hồi. Vui lòng thử lại với tài liệu ngắn hơn.';
    } else if (errorMsg === 'AI_PARSING_FAILED') {
      userFriendlyMsg = '⚠️ AI chưa thể bóc tách nội dung tài liệu này thành Study Pack. Vui lòng kiểm tra lại văn bản.';
    }

    await webhookClient.editMessage('@original', { content: userFriendlyMsg, embeds: [] }).catch(() => {});
  } finally {
    webhookClient.destroy();
  }
}

// 🛡️ ZERO-IDLE-COST QUEUE: Xử lý tối đa 5 tài liệu song song, 0 polling Redis
export const aiDocumentQueue = new AsyncWorkerQueue<AiDocumentJobData>(
  AI_DOCUMENT_QUEUE_NAME,
  5,
  processDocumentJob
);
