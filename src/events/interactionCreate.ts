import {
  Events,
  Interaction,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  AttachmentBuilder,
  EmbedBuilder,
} from 'discord.js';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { sendEphemeralAfterDefer } from '../utils/interactionReply';
import { redisClient } from '../config/redis';
import { checkDbRateLimit } from '../services/dbRateLimiter';
import { extractMermaidCode, renderMermaidToBuffer } from '../services/visualService';
import { aiImageQueue } from '../workers/imageWorker';
import * as hoiCommand from '../commands/hoi';
import * as tomtatCommand from '../commands/tomtat';
import * as pomodoroCommand from '../commands/pomodoro';
import * as quizCommand from '../commands/quiz';
import * as helpCommand from '../commands/help';
import * as configCommand from '../commands/config';
import * as profileCommand from '../commands/profile';
import * as digestCommand from '../commands/digest';
import * as flashcardCommand from '../commands/flashcard';
import * as leaderboardCommand from '../commands/leaderboard';
import * as tailieuCommand from '../commands/tailieu';
import * as studyPlanCommand from '../commands/study-plan';
import * as groupCommand from '../commands/group';

interface CommandModule {
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

const commands = new Map<string, CommandModule>([
  ['hoi', hoiCommand],
  ['tomtat', tomtatCommand],
  ['pomodoro', pomodoroCommand],
  ['quiz', quizCommand],
  ['help', helpCommand],
  ['config', configCommand],
  ['profile', profileCommand],
  ['digest', digestCommand],
  ['flashcard', flashcardCommand],
  ['leaderboard', leaderboardCommand],
  ['tailieu', tailieuCommand],
  ['study-plan', studyPlanCommand],
  ['group', groupCommand],
]);

export const name = Events.InteractionCreate;

export async function execute(interaction: Interaction): Promise<void> {
  // 🛡️ Xử lý các Button Interaction độc lập & Fallback an toàn cho button hết hạn
  if (interaction.isButton()) {
    if (interaction.customId === 'disable_daily_reminder') {
      try {
        await prisma.user.upsert({
          where: { discordUserId: interaction.user.id },
          create: {
            discordUserId: interaction.user.id,
            username: interaction.user.username,
            dailyReminderEnabled: false,
          },
          update: { dailyReminderEnabled: false },
        });

        await interaction.reply({
          content:
            '🔕 Đã tắt tính năng nhắc nhở ôn tập hàng ngày. Bạn có thể bật lại bất cứ lúc nào bằng lệnh `/profile reminder:on`.',
          ephemeral: true,
        });
      } catch (err) {
        logger.error('Error disabling daily reminder via button', { error: String(err) });
        await interaction
          .reply({
            content: '❌ Có lỗi khi cập nhật cài đặt nhắc nhở.',
            ephemeral: true,
          })
          .catch(() => {});
      }
      return;
    }

    // 🎨 XỬ LÝ NÚT BẤM SINH ẢNH / SƠ ĐỒ MINH HỌA (btn_visual_...)
    if (interaction.customId.startsWith('btn_visual_')) {
      if (!env.imageGenEnabled) {
        await interaction.reply({
          content:
            '⚠️ Tính năng tạo ảnh minh họa hiện đang tắt. Câu trả lời của bot là dạng văn bản thuần.',
          ephemeral: true,
        });
        return;
      }
      const parts = interaction.customId.split('_');
      const originalUserId = parts[parts.length - 1];

      // 1. Author Guard: Chỉ người hỏi mới có quyền bấm
      if (interaction.user.id !== originalUserId) {
        await interaction.reply({
          content:
            '⚠️ Chỉ người đặt câu hỏi ban đầu mới có quyền yêu cầu tạo ảnh cho tin nhắn này.',
          ephemeral: true,
        });
        return;
      }

      const lockKey = `visual_lock:${interaction.message.id}`;

      // 2. Atomic Redis Lock: Chống click đúp và spam nhiều request (Bắt lỗi an toàn nếu Redis mất kết nối)
      const acquired = await redisClient.set(lockKey, '1', 'EX', 60, 'NX').catch(() => 'OK');
      if (!acquired) {
        await interaction.reply({
          content:
            '⏳ Đang có một tiến trình tạo ảnh cho câu trả lời này rồi. Vui lòng chờ vài giây nhé!',
          ephemeral: true,
        });
        return;
      }

      try {
        const userRecord = await prisma.user.upsert({
          where: { discordUserId: interaction.user.id },
          create: { discordUserId: interaction.user.id, username: interaction.user.username },
          update: { username: interaction.user.username },
        });

        // 3. Kiểm tra hạn mức sinh ảnh
        const limitCheck = await checkDbRateLimit(userRecord.id, 'AI_IMAGE_GEN');
        if (!limitCheck.allowed) {
          await redisClient.del(lockKey);
          await interaction.reply({ content: limitCheck.message!, ephemeral: true });
          return;
        }

        // 4. Kiểm tra xem tin nhắn có chứa mã Mermaid không
        const originalEmbed = interaction.message.embeds[0];
        if (!originalEmbed) {
          await interaction.reply({
            content: '❌ Không tìm thấy nội dung nhúng gốc trong tin nhắn này.',
            ephemeral: true,
          });
          return;
        }
        const originalText = originalEmbed.description || '';
        const mermaidCode = extractMermaidCode(originalText);

        if (mermaidCode) {
          // 4.1. Render trực tiếp Sơ đồ Mermaid trong 1 giây
          const mermaidBuffer = await renderMermaidToBuffer(mermaidCode);

          if (mermaidBuffer) {
            const attachment = new AttachmentBuilder(mermaidBuffer, { name: 'diagram.jpg' });

            let cleanedDescription = originalText
              .replace(/```mermaid[\s\S]*?```/gi, '')
              .replace(/sequenceDiagram[\s\S]+/i, '')
              .replace(/flowchart[\s\S]+/i, '')
              .replace(/📊\s*Sơ đồ học tập\s*:?/gi, '')
              .trim();

            if (!cleanedDescription) {
              cleanedDescription =
                'Dưới đây là sơ đồ trực quan được tự động vẽ cho câu hỏi của bạn:';
            }

            const updatedEmbed = EmbedBuilder.from(originalEmbed)
              .setDescription(cleanedDescription.slice(0, 4096))
              .setImage('attachment://diagram.jpg');

            await interaction.update({
              embeds: [updatedEmbed],
              files: [attachment],
              components: [],
            });
            return;
          }
        }

        // 4.2. Làm mờ nút bấm ngay lập tức trên tin nhắn gốc
        await interaction.update({
          components: [],
        });

        // 5. Nếu không phải Mermaid -> Đẩy vào AsyncWorkerQueue Background Queue cho Imagen 3 / DALL-E
        await aiImageQueue.add('generate-image', {
          userId: userRecord.id,
          prompt: `Illustrate this study concept: ${originalText.slice(0, 300)}`,
          originalQuestion: originalEmbed?.title || 'Câu hỏi học tập',
          originalAnswer: originalText,
          webhookToken: interaction.token,
          applicationId: interaction.client.user.id,
        });

        await interaction.followUp({
          content:
            '🎨 Đã nhận lệnh! Bot đang cặm cụi vẽ ảnh minh họa dưới nền và sẽ cập nhật vào tin nhắn trong giây lát.',
          ephemeral: true,
        });
      } catch (err) {
        logger.error('Error handling btn_visual interaction', { error: String(err) });
        await redisClient.del(lockKey);
      }
      return;
    }

    // 🛡️ SAFETY NET: Nếu sau 1.5s không có Component Collector nào nhận nút (do hết hạn hoặc bot vừa restart),
    // tự động phản hồi để Discord KHÔNG BỊ LỖI "bot didn't respond in time"
    setTimeout(async () => {
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content:
              '⏱️ Phiên tương tác này đã hết hạn (hoặc Bot vừa cập nhật). Bạn vui lòng gõ lại lệnh để tiếp tục nhé!',
            ephemeral: true,
          })
          .catch(() => {});
      }
    }, 1500);

    return;
  }

  // 🛡️ Xử lý Autocomplete Interaction (Gợi ý danh sách bộ thẻ khi người dùng gõ)
  if (interaction.isAutocomplete()) {
    const command = commands.get(interaction.commandName);
    if (!command || typeof command.autocomplete !== 'function') return;

    try {
      await command.autocomplete(interaction);
    } catch (error) {
      logger.warn('Error executing autocomplete', {
        command: interaction.commandName,
        userId: interaction.user.id,
        error: String(error),
      });
      if (!interaction.responded) {
        await interaction.respond([]).catch(() => {});
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    logger.error('Error executing command', {
      command: interaction.commandName,
      userId: interaction.user.id,
      error: String(error),
    });

    const errorMsg = '❌ Có lỗi khi thực thi lệnh này.';
    if (interaction.replied) {
      // 🛡️ Câu trả lời đã được gửi: không ghi đè, báo lỗi riêng tư bằng followUp
      await interaction.followUp({ content: errorMsg, ephemeral: true }).catch(() => {});
    } else if (interaction.deferred) {
      // 🛡️ Placeholder "thinking…" công khai: xóa đi rồi báo lỗi riêng tư
      await sendEphemeralAfterDefer(interaction, errorMsg).catch(() => {});
    } else {
      await interaction.reply({ content: errorMsg, ephemeral: true }).catch(() => {});
    }
  }
}
