import { prisma } from '../config/prisma';

/**
 * Chuyển đổi Discord Guild Snowflake ID sang UUID nội bộ trong CSDL (FK-safe).
 * 
 * FlashcardDeck.guildId là Foreign Key trỏ đến Guild.id (UUID),
 * KHÔNG PHẢI Discord Guild Snowflake. Hàm này tìm record Guild tương ứng
 * và trả về UUID nội bộ. Nếu guild chưa tồn tại trong DB, trả về null.
 */
export async function resolveGuildId(discordGuildId: string | null): Promise<string | null> {
  if (!discordGuildId) return null;

  const guild = await prisma.guild.findUnique({
    where: { discordGuildId },
    select: { id: true },
  });

  return guild?.id || null;
}
