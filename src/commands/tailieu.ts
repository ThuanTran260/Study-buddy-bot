import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  EmbedBuilder,
} from 'discord.js';
import { extractDocumentContent } from '../services/documentService';
import { checkDbRateLimit } from '../services/dbRateLimiter';
import { prisma } from '../config/prisma';
import { resolveGuildId } from '../utils/guildResolver';
import { logger } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('tailieu')
  .setDescription(
    'Chuyển đổi tài liệu bài giảng thành trọn bộ học tập (Tóm tắt + Flashcard + Quiz)'
  )
  .addStringOption((opt) =>
    opt
      .setName('ten_bo_the')
      .setDescription('Tên bộ thẻ bạn muốn lưu các thẻ nhớ Flashcard vào')
      .setRequired(true)
      .setMaxLength(100)
      .setAutocomplete(true)
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

/**
 * ⚡ AUTOCOMPLETE HANDLER CHO /tailieu
 */
export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);

  if (focusedOption.name === 'ten_bo_the') {
    try {
      const user = await prisma.user.findUnique({
        where: { discordUserId: interaction.user.id },
        select: { id: true },
      });

      if (!user) {
        await interaction.respond([]);
        return;
      }

      const query = (focusedOption.value || '').trim();

      const decks = await prisma.flashcardDeck.findMany({
        where: {
          userId: user.id,
          ...(query ? { name: { contains: query, mode: 'insensitive' } } : {}),
        },
        take: 25,
        select: {
          name: true,
          _count: { select: { cards: true } },
        },
        orderBy: { name: 'asc' },
      });

      const choices = decks.map((deck) => ({
        name: `📁 ${deck.name} (Đã có ${deck._count.cards} thẻ - Nạp thêm)`.slice(0, 100),
        value: deck.name.slice(0, 100),
      }));

      if (!interaction.responded) {
        await interaction.respond(choices.slice(0, 25));
      }
    } catch {
      if (!interaction.responded) {
        await interaction.respond([]).catch(() => {});
      }
    }
  }
}

import { aiDocumentQueue } from '../workers/aiWorker';

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

    // 2.5. Resolve Discord Guild ID → Internal Guild UUID (FK-safe)
    const internalGuildId = await resolveGuildId(interaction.guildId);

    // 3. Đưa Job vào Background Queue thay vì chờ đồng bộ
    await aiDocumentQueue.add('process-document', {
      userId: user.id,
      discordUserId,
      username: interaction.user.username,
      guildId: internalGuildId,
      deckName,
      documentContent: extracted.text,
      truncated: extracted.truncated,
      webhookToken: interaction.token,
      applicationId: interaction.client.user.id, // Application ID (user.id của bot)
    });

    const pendingEmbed = new EmbedBuilder()
      .setTitle(`⏳ Đang xử lý tài liệu: "${deckName}"`)
      .setDescription(
        `Bot đang cặm cụi đọc tài liệu của bạn (có thể mất 30-60 giây). Bạn có thể lướt Discord, kết quả sẽ tự động hiển thị ở tin nhắn này khi hoàn thành!`
      )
      .setColor(0xfee75c)
      .setFooter({ text: `Hàng đợi: AI Background Job Worker` });

    await interaction.editReply({ embeds: [pendingEmbed] });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error && error.message ? error.message : String(error);
    logger.error('Error executing /tailieu', { userId: user.id, error: errorMsg });

    let userFriendlyMsg = '❌ Có lỗi xảy ra khi trích xuất tài liệu.';
    if (errorMsg === 'EMPTY_INPUT') {
      userFriendlyMsg =
        '⚠️ Bạn phải cung cấp đoạn văn bản (`noi_dung`) hoặc đính kèm một file tài liệu (`file`).';
    } else if (errorMsg === 'CONTENT_TOO_SHORT') {
      userFriendlyMsg =
        '⚠️ Tài liệu của bạn quá ngắn (dưới 50 ký tự). Vui lòng cung cấp nội dung chi tiết hơn.';
    } else if (errorMsg === 'INVALID_BINARY_CONTENT') {
      userFriendlyMsg =
        '⚠️ File tài liệu chứa định dạng nhị phân không hợp lệ. Vui lòng gửi file văn bản thuần túy (.txt, .md).';
    } else if (errorMsg === 'INVALID_FILE_TYPE') {
      userFriendlyMsg =
        '⚠️ Định dạng file không được hỗ trợ. Vui lòng chỉ gửi file `.txt` hoặc `.md`.';
    } else if (errorMsg === 'FILE_TOO_LARGE') {
      userFriendlyMsg = '⚠️ Dung lượng file quá lớn. Vui lòng chọn file dưới 1MB.';
    } else if (errorMsg === 'FETCH_TIMEOUT') {
      userFriendlyMsg = '⏱️ Tải file từ Discord bị quá thời gian chờ. Vui lòng thử lại sau.';
    } else if (errorMsg === 'PROMPT_INJECTION_DETECTED') {
      userFriendlyMsg =
        '🛡️ Tài liệu chứa nội dung cố gắng can thiệp vào AI (prompt injection). Vui lòng gửi nội dung học tập thuần túy.';
    }

    await interaction.editReply({ content: userFriendlyMsg });
  }
}
