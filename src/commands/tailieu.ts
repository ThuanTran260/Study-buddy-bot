import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { extractDocumentContent, processStudyPackIngestion } from '../services/documentService';
import { checkDbRateLimit } from '../services/dbRateLimiter';
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('tailieu')
  .setDescription('Chuyển đổi tài liệu bài giảng thành trọn bộ học tập (Tóm tắt + Flashcard + Quiz)')
  .addStringOption((opt) =>
    opt
      .setName('ten_bo_the')
      .setDescription('Tên bộ thẻ bạn muốn lưu các thẻ nhớ Flashcard vào')
      .setRequired(true)
      .setMaxLength(100)
  )
  .addStringOption((opt) =>
    opt
      .setName('noi_dung')
      .setDescription('Dán trực tiếp văn bản bài học cần phân tích (tối đa 4000 ký tự)')
      .setRequired(false)
  )
  .addAttachmentOption((opt) =>
    opt
      .setName('file')
      .setDescription('Đính kèm file tài liệu học tập (.txt, .md — tối đa 1MB)')
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const discordUserId = interaction.user.id;
  const deckName = interaction.options.getString('ten_bo_the', true).trim();
  const directText = interaction.options.getString('noi_dung');
  const fileAttachment = interaction.options.getAttachment('file');

  const user = await prisma.user.upsert({
    where: { discordUserId },
    create: { discordUserId, username: interaction.user.username },
    update: { username: interaction.user.username },
  });

  // 1. Kiểm tra hạn mức Rate Limit
  const limitCheck = await checkDbRateLimit(user.id, 'AI_DOCUMENT_STUDY');
  if (!limitCheck.allowed) {
    await interaction.reply({ content: limitCheck.message!, ephemeral: true });
    return;
  }

  await interaction.deferReply();

  try {
    // 2. Trích xuất và thẩm định an toàn nội dung tài liệu
    const extracted = await extractDocumentContent(
      directText,
      fileAttachment?.url,
      fileAttachment?.name,
      fileAttachment?.size
    );

    // 3. Xử lý qua AI Pipeline và lưu CSDL
    const result = await processStudyPackIngestion(
      user.id,
      discordUserId,
      interaction.user.username,
      interaction.guildId || null,
      deckName,
      extracted.text
    );

    const embed = new EmbedBuilder()
      .setTitle(`📑 Trọn Bộ Học Tập Study Pack: "${result.deckName}"`)
      .setColor(0x57f287)
      .setTimestamp();

    let desc = `Study Buddy AI đã phân tích tài liệu của bạn và tự động khởi tạo trọn bộ công cụ học tập!\n`;
    if (extracted.truncated) {
      desc += `\n*(ℹ️ Tài liệu dài đã được cắt gọn 12.000 ký tự đầu tiên để phân tích trọng tâm)*\n`;
    }
    embed.setDescription(desc);

    // Field 1: Tóm tắt bài học
    embed.addFields({
      name: '📝 Tóm Tắt Luận Điểm Cốt Lõi',
      value: result.summary.slice(0, 1024),
      inline: false,
    });

    // Field 2: Thẻ nhớ Flashcard
    const deckStatusText = result.isAppended
      ? `Đã nạp thêm **${result.flashcardCount} thẻ mới** vào bộ thẻ có sẵn \`${result.deckName}\``
      : `Đã tạo bộ thẻ mới \`${result.deckName}\` với **${result.flashcardCount} thẻ ghi nhớ**`;

    embed.addFields({
      name: '🗂️ Thẻ Nhớ Ghi Nhớ Lâu Dài (SM-2)',
      value: `✅ ${deckStatusText}!\n💡 Gõ \`/flashcard review ten_bo_the: "${result.deckName}"\` để bắt đầu chu kỳ ôn tập.`,
      inline: false,
    });

    // Field 3: Câu hỏi kiểm tra mẫu
    if (result.sampleQuiz) {
      const q = result.sampleQuiz;
      const optionsText = q.options.map((o) => `**${o.label}.** ${o.text}`).join('\n');
      embed.addFields({
        name: '🎯 Câu Hỏi Tự Đánh Giá Mẫu',
        value: `**${q.question}**\n${optionsText}\n*(Đáp án đúng: **${q.correctOption}** — ${q.explanation})*`,
        inline: false,
      });
    }

    embed.setFooter({
      text: `🔥 Chuỗi Streak đã được cập nhật • Còn lại: ${limitCheck.remaining - 1}/3 lượt hôm nay`,
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (error: any) {
    const errorMsg = error.message || String(error);
    logger.error('Error executing /tailieu', { userId: user.id, error: errorMsg });

    let userFriendlyMsg = '❌ Có lỗi xảy ra khi xử lý tài liệu học tập.';
    if (errorMsg === 'EMPTY_INPUT') {
      userFriendlyMsg = '⚠️ Bạn phải cung cấp đoạn văn bản (`noi_dung`) hoặc đính kèm một file tài liệu (`file`).';
    } else if (errorMsg === 'CONTENT_TOO_SHORT') {
      userFriendlyMsg = '⚠️ Tài liệu của bạn quá ngắn (dưới 50 ký tự). Vui lòng cung cấp nội dung chi tiết hơn.';
    } else if (errorMsg === 'INVALID_FILE_TYPE') {
      userFriendlyMsg = '⚠️ Định dạng file không được hỗ trợ. Vui lòng chỉ gửi file `.txt` hoặc `.md`.';
    } else if (errorMsg === 'FILE_TOO_LARGE') {
      userFriendlyMsg = '⚠️ Dung lượng file quá lớn. Vui lòng chọn file dưới 1MB.';
    } else if (errorMsg === 'FETCH_TIMEOUT') {
      userFriendlyMsg = '⏱️ Tải file từ Discord bị quá thời gian chờ. Vui lòng thử lại sau.';
    } else if (errorMsg === 'AI_TIMEOUT') {
      userFriendlyMsg = '⏱️ AI mất quá nhiều thời gian phản hồi. Vui lòng thử lại với tài liệu ngắn hơn.';
    } else if (errorMsg === 'AI_PARSING_FAILED') {
      userFriendlyMsg = '⚠️ AI chưa thể bóc tách nội dung tài liệu này thành Study Pack. Vui lòng kiểm tra lại văn bản.';
    }

    await interaction.editReply({ content: userFriendlyMsg });
  }
}
