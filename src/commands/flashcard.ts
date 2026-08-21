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
} from 'discord.js';
import { prisma } from '../config/prisma';
import { calculateSM2 } from '../services/sm2Service';
import { generateFlashcardsJson, parseFlashcardAIResponse } from '../services/aiService';
import { checkDbRateLimit, recordDbAiUsage } from '../services/dbRateLimiter';
import { recordUserActivity } from '../services/streakService';
import { resolveGuildId } from '../utils/guildResolver';
import { logger } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('flashcard')
  .setDescription('Hệ thống Flashcard thông minh với thuật toán Spaced Repetition (SM-2)')
  .addSubcommand((sub) =>
    sub
      .setName('deck-create')
      .setDescription('Tạo một bộ thẻ ghi nhớ mới')
      .addStringOption((opt) =>
        opt.setName('ten_bo_the').setDescription('Tên bộ thẻ (tối đa 100 ký tự)').setRequired(true).setMaxLength(100)
      )
      .addStringOption((opt) =>
        opt.setName('mo_ta').setDescription('Mô tả ngắn về bộ thẻ này').setRequired(false).setMaxLength(200)
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
        opt.setName('mat_truoc').setDescription('Mặt trước (Khái niệm/Từ vựng/Câu hỏi)').setRequired(true).setMaxLength(1000)
      )
      .addStringOption((opt) =>
        opt.setName('mat_sau').setDescription('Mặt sau (Định nghĩa/Giải thích/Đáp án)').setRequired(true).setMaxLength(1000)
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
        opt.setName('chu_de').setDescription('Chủ đề bạn muốn AI tạo thẻ').setRequired(true).setMaxLength(200)
      )
      .addIntegerOption((opt) =>
        opt.setName('so_the').setDescription('Số lượng thẻ (1 - 5)').setMinValue(1).setMaxValue(5).setRequired(false)
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
    sub.setName('list').setDescription('Xem danh sách tất cả các bộ thẻ và số thẻ cần ôn tập hôm nay')
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
        opt.setName('nguoi_nhan').setDescription('Người bạn muốn chia sẻ bộ thẻ này').setRequired(true)
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
  interaction: ChatInputCommandInteraction | any,
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

      // BƯỚC A: Hiện mặt trước + Nút lật thẻ
      const frontEmbed = new EmbedBuilder()
        .setTitle(`🧠 Ôn Tập Thẻ: ${card.deck.name} (${idx + 1}/${dueCards.length})`)
        .setDescription(`### ❓ Mặt trước:\n**${card.front}**\n\n*(Hãy suy nghĩ câu trả lời trong đầu rồi bấm nút bên dưới)*`)
        .setColor(0x5865f2)
        .setFooter({ text: `Lặp lại lần: ${card.repetition} • EF: ${card.easeFactor}` });

      const flipRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('sm2_flip').setLabel('👁️ Lật Thẻ (Show Answer)').setStyle(ButtonStyle.Primary)
      );

      const msg = await interaction.editReply({
        embeds: [frontEmbed],
        components: [flipRow],
        allowedMentions: { parse: [] },
      });

      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (i: any) => i.user.id === user.discordUserId,
        time: 60_000,
        max: 1,
      });

      collector.on('collect', async (btnInt: any) => {
        if (btnInt.customId === 'sm2_flip') {
          await btnInt.deferUpdate();

          // BƯỚC B: Hiện mặt sau + 4 nút đánh giá độ nhớ
          const backEmbed = new EmbedBuilder()
            .setTitle(`🧠 Ôn Tập Thẻ: ${card.deck.name} (${idx + 1}/${dueCards.length})`)
            .setDescription(
              `### ❓ Mặt trước:\n${card.front}\n\n` +
                `### 💡 Mặt sau:\n**${card.back}**\n\n` +
                `*Hãy tự đánh giá mức độ nhớ của bạn:*`
            )
            .setColor(0xfee75c)
            .setFooter({ text: 'Thuật toán SM-2 sẽ tính toán ngày ôn tiếp theo dựa trên đánh giá của bạn' });

          const ratingRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('sm2_rate_1').setLabel('🔴 Quên (1)').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('sm2_rate_3').setLabel('🟡 Khó (3)').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('sm2_rate_4').setLabel('🟢 Nhớ Tốt (4)').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('sm2_rate_5').setLabel('🌟 Rất Dễ (5)').setStyle(ButtonStyle.Primary)
          );

          const ratingMsg = await interaction.editReply({
            embeds: [backEmbed],
            components: [ratingRow],
            allowedMentions: { parse: [] },
          });

          const ratingCollector = ratingMsg.createMessageComponentCollector({
            componentType: ComponentType.Button,
            filter: (i: any) => i.user.id === user.discordUserId,
            time: 60_000,
            max: 1,
          });

          ratingCollector.on('collect', async (rateInt: any) => {
            await rateInt.deferUpdate();
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
            await recordUserActivity(user.discordUserId, user.username);
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

              await interaction.editReply({ embeds: [finishEmbed], components: [], allowedMentions: { parse: [] } });
            }
          });
        }
      });
    };

    await sendCard(0);
  } catch (error) {
    logger.error('Error in flashcard review', { userId: user.id, error: String(error) });
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: '❌ Có lỗi xảy ra trong phiên ôn tập.', components: [], embeds: [] }).catch(() => {});
    } else {
      await interaction.reply({ content: '❌ Có lỗi xảy ra trong phiên ôn tập.', ephemeral: true }).catch(() => {});
    }
  }
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const discordUserId = interaction.user.id;
  const subcommand = interaction.options.getSubcommand();

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
        await interaction.reply({ content: `❌ Bạn đã có một bộ thẻ tên là **"${deckName}"** rồi.`, ephemeral: true });
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

      await interaction.reply({
        content: `🎉 Đã tạo thành công bộ thẻ **"${deckName}"**! Dùng lệnh \`/flashcard add\` hoặc \`/flashcard ai-generate\` để thêm thẻ nhé.`,
        ephemeral: true,
      });
      return;
    } catch (error) {
      logger.error('Error in flashcard deck-create', { userId: user.id, error: String(error) });
      await interaction.reply({ content: '❌ Có lỗi khi tạo bộ thẻ.', ephemeral: true });
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
        await interaction.reply({
          content: `❌ Không tìm thấy bộ thẻ **"${deckName}"**. Bạn hãy tạo bộ thẻ trước bằng lệnh \`/flashcard deck-create\`.`,
          ephemeral: true,
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

      await interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: { parse: [] } });
      return;
    } catch (error) {
      logger.error('Error in flashcard add', { userId: user.id, error: String(error) });
      await interaction.reply({ content: '❌ Có lỗi khi thêm thẻ flashcard.', ephemeral: true });
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
      await interaction.reply({ content: limitCheck.message!, ephemeral: true });
      return;
    }

    await interaction.deferReply();

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
        await interaction.editReply({ content: '⚠️ AI chưa tạo được flashcard phù hợp. Vui lòng thử lại với chủ đề rõ ràng hơn.' });
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
        .setDescription(`Chủ đề: **${topic}**\n\nCác thẻ đã được thêm vào bộ thẻ và sẵn sàng để ôn tập ngay!`)
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
        await interaction.reply({
          content: '📭 Bạn chưa có bộ thẻ nào! Hãy tạo bộ thẻ đầu tiên bằng lệnh `/flashcard deck-create` hoặc `/flashcard ai-generate`.',
          ephemeral: true,
        });
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
        .setDescription(`Tổng cộng: **${decks.length} bộ** | **${totalCards} thẻ** | Cần ôn hôm nay: 🔥 **${totalDue} thẻ**`)
        .setColor(0x5865f2)
        .addFields(deckFields)
        .setFooter({ text: 'Dùng /flashcard review để ôn bài theo thuật toán SM-2' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
      return;
    } catch (error) {
      logger.error('Error in flashcard list', { userId: user.id, error: String(error) });
      await interaction.reply({ content: '❌ Có lỗi khi tải danh sách bộ thẻ.', ephemeral: true });
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
        await interaction.reply({
          content: '⚠️ Bạn chưa có bộ thẻ nào. Hãy dùng `/flashcard deck-create` hoặc `/flashcard ai-generate` để tạo bộ thẻ đầu tiên nhé!',
          ephemeral: true,
        });
        return;
      }

      const totalCards = decks.reduce((acc, d) => acc + d.cards.length, 0);
      const totalDue = decks.reduce((acc, d) => acc + d.cards.filter((c) => c.nextReviewAt <= now).length, 0);

      if (totalDue === 0) {
        await interaction.reply({
          content: `🎉 Tuyệt vời! Bạn đã hoàn thành toàn bộ các thẻ cần ôn hôm nay trên tất cả **${decks.length} bộ thẻ** (${totalCards} thẻ). Hãy quay lại vào ngày mai nhé!`,
          ephemeral: true,
        });
        return;
      }

      // Xây dựng danh sách lựa chọn cho Select Menu (tối đa 25 options)
      const selectOptions = [
        {
          label: '🔥 Ôn tập tất cả thẻ đến hạn',
          value: '__ALL__',
          description: `Tổng cộng ${totalDue} thẻ đang chờ ôn trên ${decks.length} bộ thẻ`.slice(0, 100),
          emoji: '📚',
        },
        ...decks
          .map((d) => {
            const due = d.cards.filter((c) => c.nextReviewAt <= now).length;
            return {
              label: d.name.slice(0, 100),
              value: d.name.slice(0, 100),
              description: `${due > 0 ? `🔥 ${due} thẻ cần ôn` : '✅ Đã hoàn thành'} • Tổng: ${d.cards.length} thẻ`.slice(0, 100),
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

      const menuMsg = await interaction.reply({
        embeds: [menuEmbed],
        components: [menuRow],
        ephemeral: true,
        fetchReply: true,
      });

      const menuCollector = menuMsg.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        filter: (i) => i.user.id === interaction.user.id,
        time: 60_000,
        max: 1,
      });

      menuCollector.on('collect', async (selectInt) => {
        const chosenValue = selectInt.values[0];
        const targetDeckName = chosenValue === '__ALL__' ? null : chosenValue;

        await selectInt.deferUpdate();
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
      await interaction.reply({ content: '❌ Có lỗi khi tải danh sách bộ thẻ ôn tập.', ephemeral: true });
      return;
    }
  }

  // 6. CHIA SẺ BỘ THẺ
  if (subcommand === 'share') {
    const deckName = interaction.options.getString('ten_bo_the', true).trim();
    const recipientUser = interaction.options.getUser('nguoi_nhan', true);

    if (recipientUser.bot) {
      await interaction.reply({ content: '❌ Bạn không thể chia sẻ bộ thẻ cho Bot.', ephemeral: true });
      return;
    }

    if (recipientUser.id === interaction.user.id) {
      await interaction.reply({ content: '❌ Bạn không thể tự chia sẻ bộ thẻ cho chính mình.', ephemeral: true });
      return;
    }

    try {
      const sourceDeck = await prisma.flashcardDeck.findUnique({
        where: { userId_name: { userId: user.id, name: deckName } },
        include: { cards: true },
      });

      if (!sourceDeck) {
        await interaction.reply({ content: `❌ Bạn không có bộ thẻ nào tên là **"${deckName}"**.`, ephemeral: true });
        return;
      }

      if (sourceDeck.cards.length === 0) {
        await interaction.reply({
          content: `⚠️ Bộ thẻ **"${deckName}"** hiện chưa có thẻ nhớ nào để chia sẻ. Hãy thêm thẻ trước nhé!`,
          ephemeral: true,
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
        new ButtonBuilder().setCustomId('confirm_share').setLabel('✅ Đồng Ý Gửi').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('cancel_share').setLabel('❌ Hủy').setStyle(ButtonStyle.Secondary)
      );

      const confirmMsg = await interaction.reply({
        embeds: [confirmEmbed],
        components: [confirmRow],
        ephemeral: true,
        fetchReply: true,
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
      await interaction.reply({ content: '❌ Có lỗi xảy ra khi chia sẻ bộ thẻ.', ephemeral: true });
      return;
    }
  }
}
