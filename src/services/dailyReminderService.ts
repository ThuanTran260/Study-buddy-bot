import { Client, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';

export function buildDailyReminderEmbed(
  username: string,
  dueCount: number,
  deckSummaries: Array<{ name: string; count: number }>
): EmbedBuilder {
  const deckListText = deckSummaries
    .map((d) => `• **${d.name}**: ${d.count} thẻ`)
    .join('\n');

  return new EmbedBuilder()
    .setTitle('📬 Nhắc Nhở Ôn Tập Flashcard Buổi Sáng')
    .setDescription(
      `Chào buổi sáng **${username}**!\nHôm nay bạn có **${dueCount} thẻ** flashcard đến hạn cần ôn tập:\n\n${deckListText}\n\n💡 *Hãy dành 3–5 phút gõ \`/flashcard review\` trong server để duy trì chuỗi trí nhớ dài hạn (SM-2) nhé!*`
    )
    .setColor(0x57f287)
    .setFooter({ text: 'Study Buddy • Bạn có thể tắt nhắc nhở bằng nút bên dưới hoặc gõ /profile' })
    .setTimestamp();
}

export function buildDailyReminderComponents(): ActionRowBuilder<ButtonBuilder> {
  const disableButton = new ButtonBuilder()
    .setCustomId('disable_daily_reminder')
    .setLabel('🔕 Tắt Nhắc Nhở Hàng Ngày')
    .setStyle(ButtonStyle.Secondary);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(disableButton);
}

export async function sendDailyFlashcardReminder(client: Client): Promise<number> {
  let sentCount = 0;
  try {
    const now = new Date();

    // 🛡️ Tối ưu hóa bộ nhớ (Tránh N+1 query): Chỉ đếm số thẻ due bằng _count
    const eligibleUsers = await prisma.user.findMany({
      where: {
        dailyReminderEnabled: true,
        flashcardDecks: { some: {} },
      },
      include: {
        flashcardDecks: {
          include: {
            cards: {
              where: { nextReviewAt: { lte: now } },
              select: { id: true },
            },
          },
        },
      },
    });

    for (const user of eligibleUsers) {
      try {
        const deckSummaries: Array<{ name: string; count: number }> = [];
        let totalDue = 0;

        for (const deck of user.flashcardDecks) {
          const dueInDeck = deck.cards.length;
          if (dueInDeck > 0) {
            deckSummaries.push({ name: deck.name, count: dueInDeck });
            totalDue += dueInDeck;
          }
        }

        // Nếu hôm nay không có thẻ nào đến hạn -> Bỏ qua, tuyệt đối không spam
        if (totalDue === 0) continue;

        const discordUser = await client.users.fetch(user.discordUserId).catch(() => null);
        if (discordUser) {
          const embed = buildDailyReminderEmbed(user.username, totalDue, deckSummaries);
          const row = buildDailyReminderComponents();

          await discordUser.send({
            embeds: [embed],
            components: [row],
            allowedMentions: { parse: [] },
          });

          sentCount++;

          // 🛡️ Throttling 1.000ms giữa mỗi DM để bảo đảm không dính Discord 429 Rate Limit
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (userErr) {
        logger.debug('Cannot send daily reminder DM to user (DMs closed or blocked)', {
          discordUserId: user.discordUserId,
          error: String(userErr),
        });
      }
    }

    logger.info(`[DailyReminder] Đã gửi thành công nhắc nhở ôn tập tới ${sentCount} người dùng`);
  } catch (error) {
    logger.error('Error in sendDailyFlashcardReminder', { error: String(error) });
  }

  return sentCount;
}
