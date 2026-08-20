import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import { prisma } from '../config/prisma';
import { calculateSM2 } from '../services/sm2Service';
import { generateFlashcardsJson, parseFlashcardAIResponse } from '../services/aiService';
import { checkDbRateLimit, recordDbAiUsage } from '../services/dbRateLimiter';
import { recordUserActivity } from '../services/streakService';
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
        opt.setName('ten_bo_the').setDescription('Tên bộ thẻ muốn thêm vào').setRequired(true).setMaxLength(100)
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
        opt.setName('ten_bo_the').setDescription('Tên bộ thẻ để lưu vào').setRequired(true).setMaxLength(100)
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
        opt.setName('ten_bo_the').setDescription('Tên bộ thẻ muốn ôn (để trống để ôn toàn bộ thẻ đến hạn)').setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub.setName('list').setDescription('Xem danh sách tất cả các bộ thẻ và số thẻ cần ôn tập hôm nay')
  );

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
          guildId: interaction.guildId || null,
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
      logger.error('Error in deck-create', { userId: user.id, error: String(error) });
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
          content: `❌ Không tìm thấy bộ thẻ **"${deckName}"**. Hãy tạo trước bằng lệnh \`/flashcard deck-create\`.`,
          ephemeral: true,
        });
        return;
      }

      await prisma.flashcard.create({
        data: {
          deckId: deck.id,
          front,
          back,
        },
      });

      await interaction.reply({
        content: `✅ Đã thêm thẻ mới vào bộ **"${deckName}"**:\n**Mặt trước:** ${front}\n**Mặt sau:** ${back}`,
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return;
    } catch (error) {
      logger.error('Error in flashcard add', { userId: user.id, error: String(error) });
      await interaction.reply({ content: '❌ Có lỗi xảy ra khi thêm thẻ.', ephemeral: true });
      return;
    }
  }

  // 3. DÙNG AI TỰ ĐỘNG TẠO THẺ
  if (subcommand === 'ai-generate') {
    const rateCheck = await checkDbRateLimit(user.id, 'AI_FLASHCARD');
    if (!rateCheck.allowed) {
      await interaction.reply({ content: rateCheck.message!, ephemeral: true });
      return;
    }

    const deckName = interaction.options.getString('ten_bo_the', true).trim();
    const topic = interaction.options.getString('chu_de', true).trim();
    const count = interaction.options.getInteger('so_the') ?? 3;

    await interaction.deferReply();

    try {
      let deck = await prisma.flashcardDeck.findUnique({
        where: { userId_name: { userId: user.id, name: deckName } },
      });

      if (!deck) {
        deck = await prisma.flashcardDeck.create({
          data: {
            userId: user.id,
            guildId: interaction.guildId || null,
            name: deckName,
            description: `Tạo tự động bởi AI - Chủ đề: ${topic}`,
          },
        });
      }

      const rawAiJson = await generateFlashcardsJson(topic, count);
      const flashcards = parseFlashcardAIResponse(rawAiJson);

      if (!flashcards || flashcards.length === 0) {
        await interaction.editReply({ content: '❌ AI không thể tạo bộ thẻ lúc này. Vui lòng thử lại với chủ đề khác.' });
        return;
      }

      for (const card of flashcards) {
        await prisma.flashcard.create({
          data: {
            deckId: deck.id,
            front: card.front,
            back: card.back,
          },
        });
      }

      await recordDbAiUsage(user.id, 'AI_FLASHCARD');

      const previewEmbed = new EmbedBuilder()
        .setTitle(`✨ Đã Tạo ${flashcards.length} Thẻ Vào Bộ "${deckName}"`)
        .setDescription(`**Chủ đề:** ${topic}\n\n` + flashcards.map((c, i) => `**Thẻ ${i + 1}:**\n• *Trước:* ${c.front}\n• *Sau:* ${c.back}`).join('\n\n'))
        .setColor(0x57f287)
        .setFooter({ text: 'Dùng lệnh /flashcard review để bắt đầu ôn tập!' })
        .setTimestamp();

      await interaction.editReply({ embeds: [previewEmbed], allowedMentions: { parse: [] } });
      return;
    } catch (error) {
      logger.error('Error in ai-generate flashcards', { userId: user.id, error: String(error) });
      await interaction.editReply({ content: '❌ Có lỗi xảy ra khi tạo thẻ bằng AI.' });
      return;
    }
  }

  // 4. DANH SÁCH BỘ THẺ
  if (subcommand === 'list') {
    try {
      const decks = await prisma.flashcardDeck.findMany({
        where: { userId: user.id },
        include: { cards: true },
      });

      if (decks.length === 0) {
        await interaction.reply({
          content: '🗂️ Bạn chưa có bộ thẻ nào. Hãy bắt đầu bằng \`/flashcard deck-create\` hoặc \`/flashcard ai-generate\`!',
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

  // 5. ÔN TẬP THEO THUẬT TOÁN SM-2 (INTERACTIVE BUTTONS)
  if (subcommand === 'review') {
    const deckName = interaction.options.getString('ten_bo_the');
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
        await interaction.reply({
          content: deckName
            ? `🎉 Tuyệt vời! Bộ thẻ **"${deckName}"** không còn thẻ nào đến hạn ôn hôm nay.`
            : '🎉 Tuyệt vời! Bạn đã hoàn thành toàn bộ các thẻ cần ôn hôm nay. Hãy quay lại vào ngày mai nhé!',
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply();

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
          filter: (i) => i.user.id === interaction.user.id,
          time: 60_000,
          max: 1,
        });

        collector.on('collect', async (btnInt) => {
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
              filter: (i) => i.user.id === interaction.user.id,
              time: 60_000,
              max: 1,
            });

            ratingCollector.on('collect', async (rateInt) => {
              await rateInt.deferUpdate();
              const quality = Number(rateInt.customId.replace('sm2_rate_', ''));

              // ÁP DỤNG THUẬT TOÁN SM-2 CHUẨN XÁC
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

              // Cập nhật chuỗi Streak học tập cho User
              await recordUserActivity(user.discordUserId, interaction.user.username);
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
      return;
    } catch (error) {
      logger.error('Error in flashcard review', { userId: user.id, error: String(error) });
      await interaction.editReply({ content: '❌ Có lỗi xảy ra trong phiên ôn tập.' });
      return;
    }
  }
}
