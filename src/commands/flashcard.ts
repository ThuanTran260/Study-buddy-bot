import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ComponentType,
  ButtonInteraction,
  Collection,
  Snowflake,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { prisma } from '../config/prisma';
import { calculateSM2 } from '../services/sm2Service';
import { generateFlashcardsJson, parseFlashcardAIResponse } from '../services/aiService';
import { checkDbRateLimit, recordDbAiUsage } from '../services/dbRateLimiter';
import { recordUserActivity } from '../services/streakService';
import {
  getUserDecks,
  getDeckWithStats,
  getDeckCards,
  renameDeck,
  resetSm2Progress,
  deleteDeck,
  updateCard,
  deleteCard,
} from '../services/flashcardManageService';
import { resolveGuildId } from '../utils/guildResolver';
import { logger } from '../utils/logger';
import { sendEphemeralAfterDefer } from '../utils/interactionReply';

// Các subcommand trả lời riêng tư (ephemeral); ai-generate và list trả lời công khai.
const EPHEMERAL_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'deck-create',
  'add',
  'review',
  'share',
]);

export const data = new SlashCommandBuilder()
  .setName('flashcard')
  .setDescription('Hệ thống Flashcard thông minh với thuật toán Spaced Repetition (SM-2)')
  .addSubcommand((sub) =>
    sub
      .setName('deck-create')
      .setDescription('Tạo một bộ thẻ ghi nhớ mới')
      .addStringOption((opt) =>
        opt
          .setName('ten_bo_the')
          .setDescription('Tên bộ thẻ (tối đa 100 ký tự)')
          .setRequired(true)
          .setMaxLength(100)
      )
      .addStringOption((opt) =>
        opt
          .setName('mo_ta')
          .setDescription('Mô tả ngắn về bộ thẻ này')
          .setRequired(false)
          .setMaxLength(200)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('Thêm một thẻ học thủ công vào bộ thẻ')
      .addStringOption((opt) =>
        opt
          .setName('ten_bo_the')
          .setDescription('Tên bộ thẻ muốn thêm vào')
          .setRequired(true)
          .setMaxLength(100)
          .setAutocomplete(true)
      )
      .addStringOption((opt) =>
        opt
          .setName('mat_truoc')
          .setDescription('Mặt trước (Khái niệm/Từ vựng/Câu hỏi)')
          .setRequired(true)
          .setMaxLength(1000)
      )
      .addStringOption((opt) =>
        opt
          .setName('mat_sau')
          .setDescription('Mặt sau (Định nghĩa/Giải thích/Đáp án)')
          .setRequired(true)
          .setMaxLength(1000)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('ai-generate')
      .setDescription('Dùng Gemini AI tự động soạn bộ thẻ học nhanh chóng')
      .addStringOption((opt) =>
        opt
          .setName('ten_bo_the')
          .setDescription('Tên bộ thẻ để lưu vào')
          .setRequired(true)
          .setMaxLength(100)
          .setAutocomplete(true)
      )
      .addStringOption((opt) =>
        opt
          .setName('chu_de')
          .setDescription('Chủ đề bạn muốn AI tạo thẻ')
          .setRequired(true)
          .setMaxLength(200)
      )
      .addIntegerOption((opt) =>
        opt
          .setName('so_the')
          .setDescription('Số lượng thẻ (1 - 5)')
          .setMinValue(1)
          .setMaxValue(5)
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('review')
      .setDescription('Bắt đầu phiên ôn tập các thẻ đến hạn theo thuật toán SuperMemo-2 (SM-2)')
      .addStringOption((opt) =>
        opt
          .setName('ten_bo_the')
          .setDescription('Tên bộ thẻ muốn ôn (để trống để chọn từ danh sách hoặc ôn toàn bộ)')
          .setRequired(false)
          .setMaxLength(100)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('list')
      .setDescription('Xem danh sách tất cả các bộ thẻ và số thẻ cần ôn tập hôm nay')
  )
  .addSubcommand((sub) =>
    sub
      .setName('share')
      .setDescription('Chia sẻ một bộ thẻ ghi nhớ cho bạn bè trong server')
      .addStringOption((opt) =>
        opt
          .setName('ten_bo_the')
          .setDescription('Tên bộ thẻ muốn chia sẻ')
          .setRequired(true)
          .setMaxLength(100)
          .setAutocomplete(true)
      )
      .addUserOption((opt) =>
        opt
          .setName('nguoi_nhan')
          .setDescription('Người bạn muốn chia sẻ bộ thẻ này')
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('manage')
      .setDescription('Quản lý bộ thẻ: xem, sửa, xóa thẻ và bộ thẻ')
      .addStringOption((opt) =>
        opt
          .setName('ten_bo_the')
          .setDescription('Tên bộ thẻ muốn quản lý (để trống để chọn từ danh sách)')
          .setRequired(false)
          .setMaxLength(100)
          .setAutocomplete(true)
      )
  );

/**
 * ⚡ AUTOCOMPLETE HANDLER — Gợi ý danh sách bộ thẻ khi người dùng gõ phím
 */
export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);

  if (focusedOption.name === 'ten_bo_the') {
    try {
      const discordUserId = interaction.user.id;

      // 🛡️ Safe query: findUnique không gây write-spam lên CSDL
      const user = await prisma.user.findUnique({
        where: { discordUserId },
        select: { id: true },
      });

      if (!user) {
        await interaction.respond([]);
        return;
      }

      const query = (focusedOption.value || '').trim();
      const now = new Date();

      // 🛡️ Query siêu nhẹ lấy tối đa 25 bộ thẻ kèm số thẻ đến hạn
      const decks = await prisma.flashcardDeck.findMany({
        where: {
          userId: user.id,
          ...(query ? { name: { contains: query, mode: 'insensitive' } } : {}),
        },
        take: 25,
        select: {
          name: true,
          _count: { select: { cards: true } },
          cards: {
            where: { nextReviewAt: { lte: now } },
            select: { id: true },
          },
        },
        orderBy: { name: 'asc' },
      });

      // 🛡️ Truncate bảo vệ payload < 100 ký tự và tối đa 25 choices
      const choices = decks.map((deck) => {
        const dueCount = deck.cards.length;
        const dueBadge = dueCount > 0 ? ` • 🔥 ${dueCount} cần ôn` : ' • ✅';
        const label = `${deck.name} (${deck._count.cards} thẻ${dueBadge})`.slice(0, 100);
        return {
          name: label,
          value: deck.name.slice(0, 100),
        };
      });

      if (!interaction.responded) {
        await interaction.respond(choices.slice(0, 25));
      }
    } catch (err) {
      logger.warn('Autocomplete error in flashcard', { error: String(err) });
      if (!interaction.responded) {
        await interaction.respond([]).catch(() => {});
      }
    }
  }
}

/**
 * 🧠 HÀM THỰC THI PHIÊN ÔN TẬP SM-2 TƯƠNG TÁC
 */
async function startReviewSession(
  interaction: ChatInputCommandInteraction,
  user: { id: string; discordUserId: string; username: string },
  deckName: string | null
): Promise<void> {
  const now = new Date();

  try {
    const dueCards = await prisma.flashcard.findMany({
      where: {
        nextReviewAt: { lte: now },
        deck: {
          userId: user.id,
          ...(deckName ? { name: deckName } : {}),
        },
      },
      include: {
        deck: true,
      },
      orderBy: { nextReviewAt: 'asc' },
    });

    if (dueCards.length === 0) {
      const msg = deckName
        ? `🎉 Tuyệt vời! Bộ thẻ **"${deckName}"** không còn thẻ nào đến hạn ôn hôm nay.`
        : '🎉 Tuyệt vời! Bạn đã hoàn thành toàn bộ các thẻ cần ôn hôm nay. Hãy quay lại vào ngày mai nhé!';

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: msg, embeds: [], components: [] });
      } else {
        await interaction.reply({ content: msg, ephemeral: true });
      }
      return;
    }

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }

    let currentIndex = 0;
    let reviewedCount = 0;

    const sendCard = async (idx: number) => {
      const card = dueCards[idx];
      if (!card) {
        await interaction.editReply({
          content: '❌ Không tìm thấy thẻ ôn tập. Vui lòng thử lệnh lại.',
        });
        return;
      }

      // BƯỚC A: Hiện mặt trước + Nút lật thẻ
      const frontEmbed = new EmbedBuilder()
        .setTitle(`🧠 Ôn Tập Thẻ: ${card.deck.name} (${idx + 1}/${dueCards.length})`)
        .setDescription(
          `### ❓ Mặt trước:\n**${card.front}**\n\n*(Hãy suy nghĩ câu trả lời trong đầu rồi bấm nút bên dưới)*`
        )
        .setColor(0x5865f2)
        .setFooter({ text: `Lặp lại lần: ${card.repetition} • EF: ${card.easeFactor}` });

      const flipButton = new ButtonBuilder()
        .setCustomId('sm2_flip')
        .setLabel('👁️ Lật Thẻ (Show Answer)')
        .setStyle(ButtonStyle.Primary);

      const flipRow = new ActionRowBuilder<ButtonBuilder>().addComponents(flipButton);

      const msg = await interaction.editReply({
        embeds: [frontEmbed],
        components: [flipRow],
        allowedMentions: { parse: [] },
      });

      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (i: ButtonInteraction) => i.user.id === user.discordUserId,
        time: 300_000, // 5 phút thời gian suy nghĩ
        max: 1,
      });

      let isFlipCollected = false;

      collector.on('collect', async (btnInt: ButtonInteraction) => {
        if (btnInt.customId === 'sm2_flip') {
          // 🛡️ PHẢN HỒI NGAY LẬP TỨC CHO DISCORD TRONG VÒNG < 50ms
          await btnInt.deferUpdate().catch(() => {});
          if (isFlipCollected) return;
          isFlipCollected = true;
          collector.stop('flipped');

          // BƯỚC B: Hiện mặt sau + 4 nút đánh giá độ nhớ
          const backEmbed = new EmbedBuilder()
            .setTitle(`🧠 Ôn Tập Thẻ: ${card.deck.name} (${idx + 1}/${dueCards.length})`)
            .setDescription(
              `### ❓ Mặt trước:\n${card.front}\n\n` +
                `### 💡 Mặt sau:\n**${card.back}**\n\n` +
                `*Hãy tự đánh giá mức độ nhớ của bạn:*`
            )
            .setColor(0xfee75c)
            .setFooter({
              text: 'Thuật toán SM-2 sẽ tính toán ngày ôn tiếp theo dựa trên đánh giá của bạn',
            });

          const rBtn1 = new ButtonBuilder()
            .setCustomId('sm2_rate_1')
            .setLabel('🔴 Quên (1)')
            .setStyle(ButtonStyle.Danger);
          const rBtn3 = new ButtonBuilder()
            .setCustomId('sm2_rate_3')
            .setLabel('🟡 Khó (3)')
            .setStyle(ButtonStyle.Secondary);
          const rBtn4 = new ButtonBuilder()
            .setCustomId('sm2_rate_4')
            .setLabel('🟢 Nhớ Tốt (4)')
            .setStyle(ButtonStyle.Success);
          const rBtn5 = new ButtonBuilder()
            .setCustomId('sm2_rate_5')
            .setLabel('🌟 Rất Dễ (5)')
            .setStyle(ButtonStyle.Primary);

          const ratingRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            rBtn1,
            rBtn3,
            rBtn4,
            rBtn5
          );

          const ratingMsg = await interaction.editReply({
            embeds: [backEmbed],
            components: [ratingRow],
            allowedMentions: { parse: [] },
          });

          const ratingCollector = ratingMsg.createMessageComponentCollector({
            componentType: ComponentType.Button,
            filter: (i: ButtonInteraction) => i.user.id === user.discordUserId,
            time: 300_000, // 5 phút
            max: 1,
          });

          let isRatingCollected = false;

          ratingCollector.on('collect', async (rateInt: ButtonInteraction) => {
            // 🛡️ PHẢN HỒI NGAY LẬP TỨC CHO DISCORD TRONG VÒNG < 50ms
            await rateInt.deferUpdate().catch(() => {});
            if (isRatingCollected) return;
            isRatingCollected = true;
            ratingCollector.stop('rated');

            const quality = Number(rateInt.customId.replace('sm2_rate_', ''));

            // Áp dụng thuật toán SM-2
            const sm2Result = calculateSM2({
              repetition: card.repetition,
              interval: card.interval,
              easeFactor: card.easeFactor,
              quality,
            });

            await prisma.flashcard.update({
              where: { id: card.id },
              data: {
                repetition: sm2Result.repetition,
                interval: sm2Result.interval,
                easeFactor: sm2Result.easeFactor,
                nextReviewAt: sm2Result.nextReviewAt,
              },
            });

            // Cập nhật chuỗi Streak học tập
            await recordUserActivity(user.discordUserId, user.username).catch(() => {});
            reviewedCount++;

            currentIndex++;
            if (currentIndex < dueCards.length) {
              await sendCard(currentIndex);
            } else {
              const finishEmbed = new EmbedBuilder()
                .setTitle('🎉 Hoàn Thành Phiên Ôn Tập!')
                .setDescription(
                  `Bạn đã ôn tập thành công **${reviewedCount}/${dueCards.length} thẻ** hôm nay theo phương pháp Spaced Repetition (SM-2).\n\n` +
                    `🔥 **Chuỗi Streak học tập của bạn đã được duy trì và nâng hạng!**`
                )
                .setColor(0x57f287)
                .setFooter({ text: 'Hẹn gặp lại bạn trong phiên ôn tiếp theo!' })
                .setTimestamp();

              await interaction.editReply({
                embeds: [finishEmbed],
                components: [],
                allowedMentions: { parse: [] },
              });
            }
          });

          ratingCollector.on(
            'end',
            async (_: Collection<Snowflake, ButtonInteraction>, reason: string) => {
              if (reason === 'time') {
                const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                  rBtn1.setDisabled(true),
                  rBtn3.setDisabled(true),
                  rBtn4.setDisabled(true),
                  rBtn5.setDisabled(true)
                );
                await interaction.editReply({ components: [disabledRow] }).catch(() => {});
              }
            }
          );
        }
      });

      collector.on('end', async (_: Collection<Snowflake, ButtonInteraction>, reason: string) => {
        if (reason === 'time') {
          const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            flipButton.setDisabled(true).setLabel('⏱️ Hết thời gian suy nghĩ (5 phút)')
          );
          await interaction.editReply({ components: [disabledRow] }).catch(() => {});
        }
      });
    };

    await sendCard(0);
  } catch (error) {
    logger.error('Error in flashcard review', { userId: user.id, error: String(error) });
    if (interaction.deferred || interaction.replied) {
      await interaction
        .editReply({ content: '❌ Có lỗi xảy ra trong phiên ôn tập.', components: [], embeds: [] })
        .catch(() => {});
    } else {
      await interaction
        .reply({ content: '❌ Có lỗi xảy ra trong phiên ôn tập.', ephemeral: true })
        .catch(() => {});
    }
  }
}

export async function handleManage(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  try {
    const dbUser = await prisma.user.findUnique({
      where: { discordUserId: interaction.user.id },
    });
    if (!dbUser) {
      await interaction.editReply({
        content: '❌ Có lỗi xảy ra. Vui lòng thử lại sau.',
        embeds: [],
        components: [],
        allowedMentions: { parse: [] },
      });
      return;
    }
    const userId = dbUser.id;

    const rawName = interaction.options.getString('ten_bo_the');
    const requestedName = rawName !== null && rawName.trim().length > 0 ? rawName.trim() : null;

    let currentDeckId: string | null = null;
    let cards: Awaited<ReturnType<typeof getDeckCards>> = [];
    let pageIndex = 0;

    const renderDashboard = async (deckId: string): Promise<void> => {
      const stats = await getDeckWithStats(deckId, userId);
      if (!stats) {
        await interaction.editReply({
          content: '❌ Không tìm thấy bộ thẻ.',
          embeds: [],
          components: [],
          allowedMentions: { parse: [] },
        });
        return;
      }
      logger.info('Flashcard manage dashboard', {
        userId,
        deckId,
        total: stats.total,
        due: stats.due,
      });
      const embed = new EmbedBuilder()
        .setTitle(`📁 ${stats.deck.name}`)
        .setDescription(stats.deck.description ?? '*Không có mô tả*')
        .setColor(0x5865f2)
        .addFields(
          { name: '📊 Tổng số thẻ', value: `${stats.total}`, inline: true },
          { name: '⏰ Cần ôn', value: `${stats.due}`, inline: true }
        )
        .setTimestamp();
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`manage_browse_${deckId}`)
          .setLabel('🔍 Xem thẻ')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(stats.total === 0),
        new ButtonBuilder()
          .setCustomId(`manage_rename_${deckId}`)
          .setLabel('✏️ Đổi tên')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`manage_reset_${deckId}`)
          .setLabel('🔄 Reset SM-2')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`manage_deldeck_${deckId}`)
          .setLabel('🗑️ Xóa bộ')
          .setStyle(ButtonStyle.Danger)
      );
      await interaction.editReply({
        embeds: [embed],
        components: [row],
        allowedMentions: { parse: [] },
      });
    };

    const renderDeckSelect = async (decks: Array<{ id: string; name: string }>): Promise<void> => {
      const options = decks.slice(0, 25).map((d) => ({
        label: d.name.slice(0, 100) || 'Bộ thẻ',
        value: d.id,
      }));
      const select = new StringSelectMenuBuilder()
        .setCustomId('manage_select_deck')
        .setPlaceholder('👉 Chọn bộ thẻ để quản lý...')
        .addOptions(options);
      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
      const embed = new EmbedBuilder()
        .setTitle('📚 Quản lý bộ thẻ')
        .setDescription('Chọn một bộ thẻ bên dưới để xem và quản lý.')
        .setColor(0x5865f2);
      await interaction.editReply({
        embeds: [embed],
        components: [row],
        allowedMentions: { parse: [] },
      });
    };

    const renderCarousel = async (): Promise<void> => {
      const deckId = currentDeckId;
      if (!deckId) {
        return;
      }
      const freshCards = await getDeckCards(deckId, userId);
      cards = freshCards;
      logger.info('Flashcard manage carousel', {
        userId,
        deckId,
        count: cards.length,
        pageIndex,
      });
      if (cards.length === 0) {
        const stats = await getDeckWithStats(deckId, userId);
        if (!stats) {
          await interaction.editReply({
            content: '❌ Không tìm thấy bộ thẻ.',
            embeds: [],
            components: [],
            allowedMentions: { parse: [] },
          });
          return;
        }
        const emptyEmbed = new EmbedBuilder()
          .setTitle(`📁 ${stats.deck.name}`)
          .setDescription('Bộ thẻ này chưa có thẻ nào. Hãy thêm thẻ mới để bắt đầu học!')
          .setColor(0x5865f2);
        const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`manage_back_${deckId}`)
            .setLabel('⬅️ Quay lại')
            .setStyle(ButtonStyle.Secondary)
        );
        await interaction.editReply({
          embeds: [emptyEmbed],
          components: [backRow],
          allowedMentions: { parse: [] },
        });
        return;
      }
      if (pageIndex < 0) {
        pageIndex = 0;
      }
      if (pageIndex >= cards.length) {
        pageIndex = cards.length - 1;
      }
      const card = cards[pageIndex];
      if (!card) {
        await interaction.editReply({
          content: '❌ Không tìm thấy thẻ (có thể vừa bị xóa).',
          embeds: [],
          components: [],
          allowedMentions: { parse: [] },
        });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle(`🃏 Thẻ ${pageIndex + 1}/${cards.length}`)
        .setDescription(`**Mặt trước:**\n${card.front}\n\n**Mặt sau:**\n${card.back}`)
        .setColor(0x5865f2)
        .setFooter({ text: `Dùng nút bên dưới để điều hướng và quản lý thẻ` });
      const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`manage_prev_${deckId}`)
          .setLabel('◀️ Trước')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pageIndex === 0),
        new ButtonBuilder()
          .setCustomId(`manage_next_${deckId}`)
          .setLabel('Sau ▶️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pageIndex >= cards.length - 1),
        new ButtonBuilder()
          .setCustomId(`manage_back_${deckId}`)
          .setLabel('⬅️ Quay lại')
          .setStyle(ButtonStyle.Secondary)
      );
      const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`manage_editcard_${card.id}`)
          .setLabel('✏️ Sửa thẻ')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`manage_delcard_${card.id}`)
          .setLabel('🗑️ Xóa thẻ')
          .setStyle(ButtonStyle.Danger)
      );
      await interaction.editReply({
        embeds: [embed],
        components: [navRow, actionRow],
        allowedMentions: { parse: [] },
      });
    };

    const renderResetConfirm = async (deckId: string): Promise<void> => {
      const stats = await getDeckWithStats(deckId, userId);
      if (!stats) {
        await interaction.editReply({
          content: '❌ Không tìm thấy bộ thẻ.',
          embeds: [],
          components: [],
          allowedMentions: { parse: [] },
        });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle('🔄 Xác nhận Reset SM-2')
        .setDescription(
          `Bạn có chắc chắn muốn reset tiến độ học (SM-2) của **${stats.total} thẻ** trong bộ **"${stats.deck.name}"** về trạng thái ban đầu?`
        )
        .setColor(0xfee75c);
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`manage_confirm_reset_${deckId}`)
          .setLabel('✅ Xác nhận')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`manage_cancel_reset_${deckId}`)
          .setLabel('❌ Hủy')
          .setStyle(ButtonStyle.Secondary)
      );
      await interaction.editReply({
        embeds: [embed],
        components: [row],
        allowedMentions: { parse: [] },
      });
    };

    const renderDeleteCardConfirm = async (cardId: string): Promise<void> => {
      const embed = new EmbedBuilder()
        .setTitle('🗑️ Xác nhận xóa thẻ')
        .setDescription('Bạn có chắc chắn muốn xóa thẻ này? Hành động này không thể hoàn tác.')
        .setColor(0xed4245);
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`manage_confirm_delcard_${cardId}`)
          .setLabel('✅ Xác nhận xóa')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`manage_cancel_delcard_${cardId}`)
          .setLabel('❌ Hủy')
          .setStyle(ButtonStyle.Secondary)
      );
      await interaction.editReply({
        embeds: [embed],
        components: [row],
        allowedMentions: { parse: [] },
      });
    };

    if (requestedName !== null) {
      const decks = await getUserDecks(userId);
      const exact = decks.find((d) => d.name === requestedName);
      const fallback = decks.find((d) => d.name.toLowerCase() === requestedName.toLowerCase());
      const matched = exact ?? fallback;
      if (!matched) {
        await interaction.editReply({
          content: `❌ Không tìm thấy bộ thẻ **"${requestedName}"**.`,
          embeds: [],
          components: [],
          allowedMentions: { parse: [] },
        });
        return;
      }
      currentDeckId = matched.id;
      await renderDashboard(currentDeckId);
    } else {
      const decks = await getUserDecks(userId);
      if (decks.length === 0) {
        await interaction.editReply({
          content:
            '📭 Bạn chưa có bộ thẻ nào! Hãy tạo bộ thẻ đầu tiên bằng lệnh `/flashcard deck-create`.',
          embeds: [],
          components: [],
          allowedMentions: { parse: [] },
        });
        return;
      }
      await renderDeckSelect(decks);
    }

    const replyMsg = await interaction.fetchReply();
    const collector = replyMsg.createMessageComponentCollector({
      filter: (i) => i.user.id === interaction.user.id && i.customId.startsWith('manage_'),
      time: 300_000,
    });

    collector.on('collect', async (i) => {
      try {
        if (i.isStringSelectMenu()) {
          if (i.customId === 'manage_select_deck') {
            await i.deferUpdate();
            const selectedId = i.values[0];
            if (!selectedId) {
              return;
            }
            currentDeckId = selectedId;
            pageIndex = 0;
            await renderDashboard(selectedId);
          }
          return;
        }
        if (!i.isButton()) {
          return;
        }
        const customId = i.customId;

        if (customId.startsWith('manage_confirm_reset_')) {
          const deckId = customId.slice('manage_confirm_reset_'.length);
          if (!deckId) {
            return;
          }
          await i.deferUpdate();
          const res = await resetSm2Progress(deckId, userId);
          logger.info('Flashcard manage reset', { userId, deckId, count: res.count });
          await interaction.followUp({
            content: `✅ Đã reset ${res.count} thẻ về trạng thái ban đầu.`,
            ephemeral: true,
            allowedMentions: { parse: [] },
          });
          currentDeckId = deckId;
          await renderDashboard(deckId);
          return;
        }

        if (customId.startsWith('manage_cancel_reset_')) {
          const deckId = customId.slice('manage_cancel_reset_'.length);
          if (!deckId) {
            return;
          }
          await i.deferUpdate();
          currentDeckId = deckId;
          await renderDashboard(deckId);
          return;
        }

        if (customId.startsWith('manage_confirm_delcard_')) {
          const cardId = customId.slice('manage_confirm_delcard_'.length);
          if (!cardId) {
            return;
          }
          await i.deferUpdate();
          const deckId = currentDeckId;
          if (!deckId) {
            return;
          }
          const res = await deleteCard(cardId, deckId, userId);
          logger.info('Flashcard manage delete card', { userId, deckId, cardId });
          if (!res.success) {
            await interaction.followUp({
              content: '❌ Không tìm thấy thẻ (có thể vừa bị xóa).',
              ephemeral: true,
              allowedMentions: { parse: [] },
            });
            await renderCarousel();
            return;
          }
          await renderCarousel();
          return;
        }

        if (customId.startsWith('manage_cancel_delcard_')) {
          await i.deferUpdate();
          await renderCarousel();
          return;
        }

        if (customId.startsWith('manage_browse_')) {
          const deckId = customId.slice('manage_browse_'.length);
          if (!deckId) {
            return;
          }
          await i.deferUpdate();
          currentDeckId = deckId;
          pageIndex = 0;
          await renderCarousel();
          return;
        }

        if (customId.startsWith('manage_rename_')) {
          const deckId = customId.slice('manage_rename_'.length);
          if (!deckId) {
            return;
          }
          const stats = await getDeckWithStats(deckId, userId);
          if (!stats) {
            await i.deferUpdate();
            await interaction.editReply({
              content: '❌ Không tìm thấy bộ thẻ.',
              embeds: [],
              components: [],
              allowedMentions: { parse: [] },
            });
            return;
          }
          const modalId = `manage_modal_rename_${deckId}`;
          const modal = new ModalBuilder().setCustomId(modalId).setTitle('✏️ Đổi tên bộ thẻ');
          const nameInput = new TextInputBuilder()
            .setCustomId('new_name')
            .setLabel('Tên mới')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(100)
            .setValue(stats.deck.name.slice(0, 100));
          const descValue = (stats.deck.description ?? '').slice(0, 200);
          const descInput = new TextInputBuilder()
            .setCustomId('new_desc')
            .setLabel('Mô tả mới')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(200);
          if (descValue.length > 0) {
            descInput.setValue(descValue);
          }
          modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(descInput)
          );
          await i.showModal(modal);
          const modalInt = await i
            .awaitModalSubmit({
              filter: (m) => m.customId === modalId && m.user.id === interaction.user.id,
              time: 120_000,
            })
            .catch(() => null);
          if (!modalInt) {
            await interaction.followUp({
              content: '⏱️ Hết thời gian nhập (120 giây). Vui lòng thử lại.',
              ephemeral: true,
              allowedMentions: { parse: [] },
            });
            return;
          }
          const newName = modalInt.fields.getTextInputValue('new_name');
          const newDesc = modalInt.fields.getTextInputValue('new_desc');
          const result = await renameDeck(deckId, userId, newName, newDesc);
          logger.info('Flashcard manage rename', { userId, deckId });
          if (!result.success) {
            let msg = '❌ Không tìm thấy bộ thẻ.';
            if (result.reason === 'NAME_EXISTS') {
              msg = '❌ Tên này đã tồn tại, chọn tên khác.';
            } else if (result.reason === 'EMPTY_NAME') {
              msg = '❌ Tên không được để trống.';
            }
            await modalInt.reply({
              content: msg,
              ephemeral: true,
              allowedMentions: { parse: [] },
            });
            currentDeckId = deckId;
            await renderDashboard(deckId);
            return;
          }
          await modalInt.reply({
            content: `✅ Đã đổi tên bộ thẻ thành **"${result.deck.name}"**.`,
            ephemeral: true,
            allowedMentions: { parse: [] },
          });
          currentDeckId = deckId;
          await renderDashboard(deckId);
          return;
        }

        if (customId.startsWith('manage_reset_')) {
          const deckId = customId.slice('manage_reset_'.length);
          if (!deckId) {
            return;
          }
          await i.deferUpdate();
          currentDeckId = deckId;
          await renderResetConfirm(deckId);
          return;
        }

        if (customId.startsWith('manage_deldeck_')) {
          const deckId = customId.slice('manage_deldeck_'.length);
          if (!deckId) {
            return;
          }
          const stats = await getDeckWithStats(deckId, userId);
          if (!stats) {
            await i.deferUpdate();
            await interaction.editReply({
              content: '❌ Không tìm thấy bộ thẻ.',
              embeds: [],
              components: [],
              allowedMentions: { parse: [] },
            });
            return;
          }
          const modalId = `manage_modal_deldeck_${deckId}`;
          const modal = new ModalBuilder().setCustomId(modalId).setTitle('🗑️ Xóa bộ thẻ');
          const confirmInput = new TextInputBuilder()
            .setCustomId('confirm')
            .setLabel('Xác nhận xóa')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100)
            .setPlaceholder("Gõ 'xác nhận' hoặc tên bộ thẻ");
          modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(confirmInput));
          await i.showModal(modal);
          const modalInt = await i
            .awaitModalSubmit({
              filter: (m) => m.customId === modalId && m.user.id === interaction.user.id,
              time: 120_000,
            })
            .catch(() => null);
          if (!modalInt) {
            await interaction.followUp({
              content: '⏱️ Hết thời gian nhập (120 giây). Vui lòng thử lại.',
              ephemeral: true,
              allowedMentions: { parse: [] },
            });
            return;
          }
          const input = modalInt.fields.getTextInputValue('confirm');
          const fresh = await getDeckWithStats(deckId, userId);
          if (!fresh) {
            await modalInt.reply({
              content: '❌ Không tìm thấy bộ thẻ.',
              ephemeral: true,
              allowedMentions: { parse: [] },
            });
            return;
          }
          const normalized = input.trim().toLowerCase();
          const accepted = new Set<string>([
            'xac nhan',
            'xác nhận',
            'delete',
            fresh.deck.name.toLowerCase(),
          ]);
          if (!accepted.has(normalized)) {
            await modalInt.reply({
              content: "❌ Xác nhận không đúng. Vui lòng gõ 'xác nhận' hoặc tên bộ thẻ để xóa.",
              ephemeral: true,
              allowedMentions: { parse: [] },
            });
            return;
          }
          const delRes = await deleteDeck(deckId, userId);
          logger.info('Flashcard manage delete deck', { userId, deckId });
          if (!delRes.success) {
            await modalInt.reply({
              content: '❌ Không tìm thấy bộ thẻ.',
              ephemeral: true,
              allowedMentions: { parse: [] },
            });
            return;
          }
          await modalInt.reply({
            content: `✅ Đã xóa bộ thẻ **"${fresh.deck.name}"**.`,
            ephemeral: true,
            allowedMentions: { parse: [] },
          });
          currentDeckId = null;
          await interaction.editReply({
            content: `✅ Đã xóa bộ thẻ **"${fresh.deck.name}"**.`,
            embeds: [],
            components: [],
            allowedMentions: { parse: [] },
          });
          return;
        }

        if (customId.startsWith('manage_prev_')) {
          await i.deferUpdate();
          pageIndex = pageIndex - 1;
          if (pageIndex < 0) {
            pageIndex = 0;
          }
          await renderCarousel();
          return;
        }

        if (customId.startsWith('manage_next_')) {
          await i.deferUpdate();
          pageIndex = pageIndex + 1;
          await renderCarousel();
          return;
        }

        if (
          customId.startsWith('manage_back_') ||
          customId === 'manage_back' ||
          customId === 'manage_select_back'
        ) {
          await i.deferUpdate();
          const deckId = currentDeckId;
          if (!deckId) {
            return;
          }
          await renderDashboard(deckId);
          return;
        }

        if (customId.startsWith('manage_editcard_')) {
          const cardId = customId.slice('manage_editcard_'.length);
          if (!cardId) {
            return;
          }
          const deckId = currentDeckId;
          if (!deckId) {
            await i.deferUpdate();
            return;
          }
          let oldCard = cards.find((c) => c.id === cardId);
          if (!oldCard) {
            const refetched = await getDeckCards(deckId, userId);
            cards = refetched;
            oldCard = cards.find((c) => c.id === cardId);
          }
          if (!oldCard) {
            await i.deferUpdate();
            await interaction.followUp({
              content: '❌ Không tìm thấy thẻ (có thể vừa bị xóa).',
              ephemeral: true,
              allowedMentions: { parse: [] },
            });
            await renderCarousel();
            return;
          }
          const modalId = `manage_modal_editcard_${cardId}`;
          const modal = new ModalBuilder().setCustomId(modalId).setTitle('✏️ Sửa thẻ');
          const frontInput = new TextInputBuilder()
            .setCustomId('front')
            .setLabel('Mặt trước')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(1000)
            .setValue(oldCard.front.slice(0, 1000));
          const backInput = new TextInputBuilder()
            .setCustomId('back')
            .setLabel('Mặt sau')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(1000)
            .setValue(oldCard.back.slice(0, 1000));
          modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(frontInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(backInput)
          );
          await i.showModal(modal);
          const modalInt = await i
            .awaitModalSubmit({
              filter: (m) => m.customId === modalId && m.user.id === interaction.user.id,
              time: 120_000,
            })
            .catch(() => null);
          if (!modalInt) {
            await interaction.followUp({
              content: '⏱️ Hết thời gian nhập (120 giây). Vui lòng thử lại.',
              ephemeral: true,
              allowedMentions: { parse: [] },
            });
            return;
          }
          const front = modalInt.fields.getTextInputValue('front');
          const back = modalInt.fields.getTextInputValue('back');
          const res = await updateCard(cardId, deckId, userId, front, back);
          logger.info('Flashcard manage update card', { userId, deckId, cardId });
          if (!res.success) {
            await modalInt.reply({
              content: '❌ Không tìm thấy thẻ (có thể vừa bị xóa).',
              ephemeral: true,
              allowedMentions: { parse: [] },
            });
            await renderCarousel();
            return;
          }
          await modalInt.reply({
            content: '✅ Đã cập nhật thẻ.',
            ephemeral: true,
            allowedMentions: { parse: [] },
          });
          await renderCarousel();
          return;
        }

        if (customId.startsWith('manage_delcard_')) {
          const cardId = customId.slice('manage_delcard_'.length);
          if (!cardId) {
            return;
          }
          await i.deferUpdate();
          await renderDeleteCardConfirm(cardId);
          return;
        }

        await i.deferUpdate();
      } catch (err) {
        logger.error('Error in flashcard manage collector', {
          userId,
          error: String(err),
        });
      }
    });

    collector.on('end', async () => {
      await interaction.editReply({ components: [] }).catch(() => {});
    });
  } catch (error) {
    logger.error('Error in flashcard manage', { error: String(error) });
    await interaction
      .editReply({
        content: '❌ Có lỗi xảy ra. Vui lòng thử lại sau.',
        embeds: [],
        components: [],
        allowedMentions: { parse: [] },
      })
      .catch(() => {});
  }
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const discordUserId = interaction.user.id;
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'manage') {
    await handleManage(interaction);
    return;
  }

  // ⚡ Defer NGAY trước mọi I/O (DB/Redis) để tránh DiscordAPIError[10062] Unknown interaction.
  // Ephemerality khớp với các reply trước đây: deck-create/add/review/share riêng tư, ai-generate/list công khai.
  await interaction.deferReply({ ephemeral: EPHEMERAL_SUBCOMMANDS.has(subcommand) });

  // Đảm bảo User có trong CSDL
  const user = await prisma.user.upsert({
    where: { discordUserId },
    create: { discordUserId, username: interaction.user.username },
    update: { username: interaction.user.username },
  });

  // 1. TẠO BỘ THẺ MỚI
  if (subcommand === 'deck-create') {
    const deckName = interaction.options.getString('ten_bo_the', true).trim();
    const description = interaction.options.getString('mo_ta');

    try {
      const existing = await prisma.flashcardDeck.findUnique({
        where: { userId_name: { userId: user.id, name: deckName } },
      });

      if (existing) {
        await interaction.editReply({
          content: `❌ Bạn đã có một bộ thẻ tên là **"${deckName}"** rồi.`,
          allowedMentions: { parse: [] },
        });
        return;
      }

      await prisma.flashcardDeck.create({
        data: {
          userId: user.id,
          guildId: await resolveGuildId(interaction.guildId),
          name: deckName,
          description: description || null,
        },
      });

      await interaction.editReply({
        content: `🎉 Đã tạo thành công bộ thẻ **"${deckName}"**! Dùng lệnh \`/flashcard add\` hoặc \`/flashcard ai-generate\` để thêm thẻ nhé.`,
        allowedMentions: { parse: [] },
      });
      return;
    } catch (error) {
      logger.error('Error in flashcard deck-create', { userId: user.id, error: String(error) });
      await interaction.editReply({
        content: '❌ Có lỗi khi tạo bộ thẻ.',
        allowedMentions: { parse: [] },
      });
      return;
    }
  }

  // 2. THÊM THẺ THỦ CÔNG
  if (subcommand === 'add') {
    const deckName = interaction.options.getString('ten_bo_the', true).trim();
    const front = interaction.options.getString('mat_truoc', true).trim();
    const back = interaction.options.getString('mat_sau', true).trim();

    try {
      const deck = await prisma.flashcardDeck.findUnique({
        where: { userId_name: { userId: user.id, name: deckName } },
      });

      if (!deck) {
        await interaction.editReply({
          content: `❌ Không tìm thấy bộ thẻ **"${deckName}"**. Bạn hãy tạo bộ thẻ trước bằng lệnh \`/flashcard deck-create\`.`,
          allowedMentions: { parse: [] },
        });
        return;
      }

      await prisma.flashcard.create({
        data: {
          deckId: deck.id,
          front,
          back,
          repetition: 0,
          interval: 1,
          easeFactor: 2.5,
          nextReviewAt: new Date(),
        },
      });

      const embed = new EmbedBuilder()
        .setTitle('✅ Đã Thêm Thẻ Mới Thành Công!')
        .setDescription(`Đã thêm vào bộ thẻ: **${deckName}**`)
        .setColor(0x57f287)
        .addFields(
          { name: '❓ Mặt trước', value: front, inline: false },
          { name: '💡 Mặt sau', value: back, inline: false }
        )
        .setFooter({ text: 'Thẻ đã sẵn sàng để ôn tập ngay hôm nay!' });

      await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
      return;
    } catch (error) {
      logger.error('Error in flashcard add', { userId: user.id, error: String(error) });
      await interaction.editReply({
        content: '❌ Có lỗi khi thêm thẻ flashcard.',
        allowedMentions: { parse: [] },
      });
      return;
    }
  }

  // 3. TẠO THẺ TỰ ĐỘNG BẰNG AI
  if (subcommand === 'ai-generate') {
    const deckName = interaction.options.getString('ten_bo_the', true).trim();
    const topic = interaction.options.getString('chu_de', true).trim();
    const count = interaction.options.getInteger('so_the') || 3;

    const limitCheck = await checkDbRateLimit(user.id, 'AI_FLASHCARD');
    if (!limitCheck.allowed) {
      // Placeholder đang công khai -> xóa rồi gửi thông báo riêng tư
      await sendEphemeralAfterDefer(interaction, limitCheck.message!);
      return;
    }

    try {
      let deck = await prisma.flashcardDeck.findUnique({
        where: { userId_name: { userId: user.id, name: deckName } },
      });

      if (!deck) {
        deck = await prisma.flashcardDeck.create({
          data: {
            userId: user.id,
            guildId: await resolveGuildId(interaction.guildId),
            name: deckName,
            description: `Tạo tự động bởi AI - Chủ đề: ${topic}`,
          },
        });
      }

      const rawAiJson = await generateFlashcardsJson(topic, count);
      const flashcards = parseFlashcardAIResponse(rawAiJson);

      if (!flashcards || flashcards.length === 0) {
        await interaction.editReply({
          content:
            '⚠️ AI chưa tạo được flashcard phù hợp. Vui lòng thử lại với chủ đề rõ ràng hơn.',
        });
        return;
      }

      const cardsData = flashcards.map((f) => ({
        deckId: deck.id,
        front: f.front,
        back: f.back,
        repetition: 0,
        interval: 1,
        easeFactor: 2.5,
        nextReviewAt: new Date(),
      }));

      await prisma.flashcard.createMany({ data: cardsData });
      await recordDbAiUsage(user.id, 'AI_FLASHCARD');
      await recordUserActivity(user.discordUserId, interaction.user.username);

      const embed = new EmbedBuilder()
        .setTitle(`✨ AI Đã Tạo Xong ${flashcards.length} Thẻ Cho Bộ "${deckName}"`)
        .setDescription(
          `Chủ đề: **${topic}**\n\nCác thẻ đã được thêm vào bộ thẻ và sẵn sàng để ôn tập ngay!`
        )
        .setColor(0x5865f2)
        .addFields(
          flashcards.slice(0, 5).map((f, idx) => ({
            name: `Thẻ #${idx + 1}: ${f.front.slice(0, 50)}${f.front.length > 50 ? '...' : ''}`,
            value: `💡 ${f.back.slice(0, 100)}${f.back.length > 100 ? '...' : ''}`,
            inline: false,
          }))
        )
        .setFooter({ text: `Còn lại: ${limitCheck.remaining - 1}/5 lượt AI tạo flashcard hôm nay` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
      return;
    } catch (error) {
      logger.error('Error in flashcard ai-generate', { userId: user.id, error: String(error) });
      await interaction.editReply({ content: '❌ Có lỗi xảy ra khi yêu cầu AI tạo thẻ.' });
      return;
    }
  }

  // 4. XEM DANH SÁCH BỘ THẺ
  if (subcommand === 'list') {
    try {
      const decks = await prisma.flashcardDeck.findMany({
        where: { userId: user.id },
        include: {
          cards: {
            select: { id: true, nextReviewAt: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (decks.length === 0) {
        await sendEphemeralAfterDefer(
          interaction,
          '📭 Bạn chưa có bộ thẻ nào! Hãy tạo bộ thẻ đầu tiên bằng lệnh `/flashcard deck-create` hoặc `/flashcard ai-generate`.'
        );
        return;
      }

      const now = new Date();
      let totalCards = 0;
      let totalDue = 0;

      const deckFields = decks.map((d) => {
        const dueCount = d.cards.filter((c) => c.nextReviewAt <= now).length;
        totalCards += d.cards.length;
        totalDue += dueCount;
        return {
          name: `📁 ${d.name}`,
          value: `• Tổng: **${d.cards.length} thẻ** | Cần ôn: ⏰ **${dueCount} thẻ**\n• ${d.description || '*Không có mô tả*'}`,
          inline: false,
        };
      });

      const embed = new EmbedBuilder()
        .setTitle(`🗂️ Danh Sách Bộ Thẻ Của ${interaction.user.username}`)
        .setDescription(
          `Tổng cộng: **${decks.length} bộ** | **${totalCards} thẻ** | Cần ôn hôm nay: 🔥 **${totalDue} thẻ**`
        )
        .setColor(0x5865f2)
        .addFields(deckFields)
        .setFooter({ text: 'Dùng /flashcard review để ôn bài theo thuật toán SM-2' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
      return;
    } catch (error) {
      logger.error('Error in flashcard list', { userId: user.id, error: String(error) });
      await sendEphemeralAfterDefer(interaction, '❌ Có lỗi khi tải danh sách bộ thẻ.');
      return;
    }
  }

  // 5. ÔN TẬP THEO THUẬT TOÁN SM-2 (INTERACTIVE BUTTONS / SELECT MENU)
  if (subcommand === 'review') {
    const deckName = interaction.options.getString('ten_bo_the');

    // 🌟 TRƯỜNG HỢP 1: Người dùng đã chỉ định tên bộ thẻ cụ thể
    if (deckName) {
      await startReviewSession(interaction, user, deckName.trim());
      return;
    }

    // 🌟 TRƯỜNG HỢP 2: Không truyền tham số -> Hiển thị StringSelectMenu chọn bộ thẻ trực quan!
    const now = new Date();
    try {
      const decks = await prisma.flashcardDeck.findMany({
        where: { userId: user.id },
        include: {
          cards: {
            select: { nextReviewAt: true },
          },
        },
        orderBy: { name: 'asc' },
      });

      if (decks.length === 0) {
        await interaction.editReply({
          content:
            '⚠️ Bạn chưa có bộ thẻ nào. Hãy dùng `/flashcard deck-create` hoặc `/flashcard ai-generate` để tạo bộ thẻ đầu tiên nhé!',
          allowedMentions: { parse: [] },
        });
        return;
      }

      const totalCards = decks.reduce((acc, d) => acc + d.cards.length, 0);
      const totalDue = decks.reduce(
        (acc, d) => acc + d.cards.filter((c) => c.nextReviewAt <= now).length,
        0
      );

      if (totalDue === 0) {
        await interaction.editReply({
          content: `🎉 Tuyệt vời! Bạn đã hoàn thành toàn bộ các thẻ cần ôn hôm nay trên tất cả **${decks.length} bộ thẻ** (${totalCards} thẻ). Hãy quay lại vào ngày mai nhé!`,
          allowedMentions: { parse: [] },
        });
        return;
      }

      // Xây dựng danh sách lựa chọn cho Select Menu (tối đa 25 options)
      const selectOptions = [
        {
          label: '🔥 Ôn tập tất cả thẻ đến hạn',
          value: '__ALL__',
          description: `Tổng cộng ${totalDue} thẻ đang chờ ôn trên ${decks.length} bộ thẻ`.slice(
            0,
            100
          ),
          emoji: '📚',
        },
        ...decks
          .map((d) => {
            const due = d.cards.filter((c) => c.nextReviewAt <= now).length;
            return {
              label: d.name.slice(0, 100),
              value: d.name.slice(0, 100),
              description:
                `${due > 0 ? `🔥 ${due} thẻ cần ôn` : '✅ Đã hoàn thành'} • Tổng: ${d.cards.length} thẻ`.slice(
                  0,
                  100
                ),
              emoji: due > 0 ? '⏰' : '📁',
            };
          })
          .slice(0, 24),
      ];

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('flashcard_select_review_deck')
        .setPlaceholder('👉 Bấm vào đây để chọn bộ thẻ bạn muốn ôn tập...')
        .addOptions(selectOptions);

      const menuRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

      const menuEmbed = new EmbedBuilder()
        .setTitle('🎯 Chọn Bộ Thẻ Bạn Muốn Ôn Tập')
        .setDescription(
          `Chào **${interaction.user.username}**, hiện bạn có **${totalDue} thẻ đến hạn ôn** trên tổng số **${totalCards} thẻ**.\n\n` +
            `👇 *Hãy chọn một bộ thẻ cụ thể hoặc chọn **"Ôn tập tất cả thẻ đến hạn"** từ danh sách bên dưới:*`
        )
        .setColor(0x5865f2)
        .setFooter({ text: 'Menu tự động đóng sau 60 giây' });

      // editReply trả về Message -> collector gắn vào đúng message này
      const menuMsg = await interaction.editReply({
        embeds: [menuEmbed],
        components: [menuRow],
        allowedMentions: { parse: [] },
      });

      const menuCollector = menuMsg.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        filter: (i) => i.user.id === interaction.user.id,
        time: 60_000,
        max: 1,
      });

      menuCollector.on('collect', async (selectInt) => {
        await selectInt.deferUpdate();
        const chosenValue = selectInt.values[0];
        if (!chosenValue) return;
        const targetDeckName = chosenValue === '__ALL__' ? null : chosenValue;

        await startReviewSession(interaction, user, targetDeckName);
      });

      menuCollector.on('end', async (_, reason) => {
        if (reason === 'time') {
          const disabledRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            selectMenu.setDisabled(true).setPlaceholder('⏱️ Đã hết thời gian chọn bộ thẻ')
          );
          await interaction.editReply({ components: [disabledRow] }).catch(() => {});
        }
      });

      return;
    } catch (error) {
      logger.error('Error in flashcard review menu', { userId: user.id, error: String(error) });
      await interaction.editReply({
        content: '❌ Có lỗi khi tải danh sách bộ thẻ ôn tập.',
        allowedMentions: { parse: [] },
      });
      return;
    }
  }

  // 6. CHIA SẺ BỘ THẺ
  if (subcommand === 'share') {
    const deckName = interaction.options.getString('ten_bo_the', true).trim();
    const recipientUser = interaction.options.getUser('nguoi_nhan', true);

    if (recipientUser.bot) {
      await interaction.editReply({
        content: '❌ Bạn không thể chia sẻ bộ thẻ cho Bot.',
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (recipientUser.id === interaction.user.id) {
      await interaction.editReply({
        content: '❌ Bạn không thể tự chia sẻ bộ thẻ cho chính mình.',
        allowedMentions: { parse: [] },
      });
      return;
    }

    try {
      const sourceDeck = await prisma.flashcardDeck.findUnique({
        where: { userId_name: { userId: user.id, name: deckName } },
        include: { cards: true },
      });

      if (!sourceDeck) {
        await interaction.editReply({
          content: `❌ Bạn không có bộ thẻ nào tên là **"${deckName}"**.`,
          allowedMentions: { parse: [] },
        });
        return;
      }

      if (sourceDeck.cards.length === 0) {
        await interaction.editReply({
          content: `⚠️ Bộ thẻ **"${deckName}"** hiện chưa có thẻ nhớ nào để chia sẻ. Hãy thêm thẻ trước nhé!`,
          allowedMentions: { parse: [] },
        });
        return;
      }

      const targetUser = await prisma.user.upsert({
        where: { discordUserId: recipientUser.id },
        create: { discordUserId: recipientUser.id, username: recipientUser.username },
        update: { username: recipientUser.username },
      });

      const confirmEmbed = new EmbedBuilder()
        .setTitle('📤 Xác Nhận Chia Sẻ Bộ Thẻ')
        .setDescription(
          `Bạn có chắc chắn muốn sao chép toàn bộ **${sourceDeck.cards.length} thẻ** từ bộ thẻ **"${sourceDeck.name}"** sang tài khoản của **@${recipientUser.username}** không?\n\n` +
            `*(Học sinh nhận thẻ sẽ bắt đầu chu kỳ ôn tập từ đầu độc lập với bạn)*`
        )
        .setColor(0xfee75c);

      const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('confirm_share')
          .setLabel('✅ Đồng Ý Gửi')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('cancel_share')
          .setLabel('❌ Hủy')
          .setStyle(ButtonStyle.Secondary)
      );

      // editReply trả về Message -> collector gắn vào đúng message này
      const confirmMsg = await interaction.editReply({
        embeds: [confirmEmbed],
        components: [confirmRow],
        allowedMentions: { parse: [] },
      });

      const collector = confirmMsg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (i) => i.user.id === interaction.user.id,
        time: 30_000,
        max: 1,
      });

      collector.on('collect', async (btnInt) => {
        if (btnInt.customId === 'cancel_share') {
          await btnInt.update({ content: '🚫 Đã hủy chia sẻ bộ thẻ.', embeds: [], components: [] });
          return;
        }

        await btnInt.deferUpdate();

        let targetDeckName = sourceDeck.name;
        let suffix = 1;
        while (true) {
          const existing = await prisma.flashcardDeck.findUnique({
            where: { userId_name: { userId: targetUser.id, name: targetDeckName } },
          });
          if (!existing) break;
          targetDeckName = `${sourceDeck.name} (Shared ${suffix++})`;
        }

        await prisma.$transaction(async (tx) => {
          const existingTargetDeck = await tx.flashcardDeck.findUnique({
            where: { userId_name: { userId: targetUser.id, name: targetDeckName } },
          });

          let finalDeckId: string;
          if (existingTargetDeck) {
            finalDeckId = existingTargetDeck.id;
          } else {
            const newDeck = await tx.flashcardDeck.create({
              data: {
                userId: targetUser.id,
                guildId: await resolveGuildId(interaction.guildId),
                name: targetDeckName,
                description: sourceDeck.description
                  ? `${sourceDeck.description} (Chia sẻ bởi @${interaction.user.username})`
                  : `Chia sẻ bởi @${interaction.user.username}`,
              },
            });
            finalDeckId = newDeck.id;
          }

          const cardsToCreate = sourceDeck.cards.map((c) => ({
            deckId: finalDeckId,
            front: c.front,
            back: c.back,
            repetition: 0,
            interval: 1,
            easeFactor: 2.5,
            nextReviewAt: new Date(),
          }));

          await tx.flashcard.createMany({ data: cardsToCreate });
        });

        const successEmbed = new EmbedBuilder()
          .setTitle('🎉 Chia Sẻ Bộ Thẻ Thành Công!')
          .setDescription(
            `Đã sao chép trọn bộ **${sourceDeck.cards.length} thẻ** từ **"${sourceDeck.name}"** sang bộ thẻ **"${targetDeckName}"** của <@${recipientUser.id}>!`
          )
          .setColor(0x57f287);

        await interaction.editReply({ embeds: [successEmbed], components: [] });
      });

      return;
    } catch (error) {
      logger.error('Error in flashcard share', { userId: user.id, error: String(error) });
      await interaction.editReply({
        content: '❌ Có lỗi xảy ra khi chia sẻ bộ thẻ.',
        allowedMentions: { parse: [] },
      });
      return;
    }
  }
}
