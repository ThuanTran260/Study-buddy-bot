import { Worker, Job, Queue } from 'bullmq';
import { redisClient } from '../config/redis';
import { generateAiIllustration } from '../services/visualService';
import { recordDbAiUsage } from '../services/dbRateLimiter';
import { logger } from '../utils/logger';
import { EmbedBuilder, WebhookClient, AttachmentBuilder } from 'discord.js';

export const AI_IMAGE_QUEUE_NAME = 'ai-image-queue';

export interface AiImageJobData {
  userId: string;
  prompt: string;
  originalQuestion: string;
  originalAnswer: string;
  webhookToken: string;
  applicationId: string;
}

export const aiImageQueue = new Queue<AiImageJobData>(AI_IMAGE_QUEUE_NAME, {
  connection: redisClient,
});

export const aiImageWorker = new Worker<AiImageJobData>(
  AI_IMAGE_QUEUE_NAME,
  async (job: Job<AiImageJobData>) => {
    logger.info(`Đang xử lý Job Image ${job.id} cho prompt: "${job.data.prompt.slice(0, 50)}..."`);

    const {
      userId,
      prompt,
      originalQuestion,
      originalAnswer,
      webhookToken,
      applicationId,
    } = job.data;

    const webhookClient = new WebhookClient({
      id: applicationId,
      token: webhookToken,
    });

    try {
      const result = await generateAiIllustration(prompt);

      if (!result.ok) {
        const reasonMessages: Record<string, string> = {
          SAFETY_BLOCKED: 'AI từ chối yêu cầu này do bộ lọc an toàn.',
          QUOTA_EXCEEDED: 'Hạn mức tạo ảnh tạm cạn (free tier) — vui lòng thử lại sau vài giờ.',
          CONFIG_ERROR: 'Model tạo ảnh không khả dụng với API key hiện tại — cần kiểm tra cấu hình.',
          EMPTY_PROMPT: 'Yêu cầu tạo ảnh trống.',
          GENERATION_FAILED: 'AI tạm thời lỗi hoặc quá tải — vui lòng thử lại.',
        };
        const reasonText = reasonMessages[result.reason] ?? reasonMessages.GENERATION_FAILED;
        await webhookClient.editMessage('@original', {
          content: `⚠️ **Không thể tạo ảnh minh họa**: ${reasonText} Dưới đây là câu trả lời văn bản:\n\n${originalAnswer}`,
          components: [],
        });
        return;
      }

      const attachment = new AttachmentBuilder(result.buffer, { name: 'illustration.png' });

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🎨 Ảnh Minh Họa: "${originalQuestion.slice(0, 100)}"`)
        .setDescription(originalAnswer.slice(0, 2048))
        .setImage('attachment://illustration.png')
        .setFooter({ text: 'Study Buddy Multi-Modal AI • Tạo bởi Google Imagen 3 / DALL-E' })
        .setTimestamp();

      await webhookClient.editMessage('@original', {
        content: '',
        embeds: [embed],
        files: [attachment],
        components: [],
      });

      // Ghi nhận hạn mức đã dùng
      await recordDbAiUsage(userId, 'AI_IMAGE_GEN').catch((err) => {
        logger.warn('Failed to record AI image usage log', { error: String(err) });
      });

      logger.info(`Job Image ${job.id} hoàn thành thành công.`);
    } catch (error: unknown) {
      logger.error(`Job Image ${job.id} thất bại`, { error: String(error) });
      await webhookClient.editMessage('@original', {
        content: `❌ Có lỗi xảy ra khi tạo ảnh minh họa. Dưới đây là câu trả lời văn bản:\n\n${originalAnswer}`,
        components: [],
      }).catch(() => {});
    } finally {
      webhookClient.destroy();
    }
  },
  {
    connection: redisClient,
    concurrency: 2, // 🛡️ Giới hạn tối đa 2 jobs song song để bảo vệ RAM 512MB
  }
);

aiImageWorker.on('failed', (job, err) => {
  logger.error(`Image Worker failed processing job ${job?.id}`, { error: String(err) });
});
