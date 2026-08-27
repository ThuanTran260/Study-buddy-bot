import { redisClient } from '../config/redis';
import { logger } from '../utils/logger';

export interface ConversationMessage {
  role: 'user' | 'model';
  content: string;
}

const MAX_MESSAGES_PER_USER = 10; // 5 cặp (User + Model)
const TTL_SECONDS = 30 * 60; // 30 phút
const TTL_MS = TTL_SECONDS * 1000;

function getRedisKey(discordUserId: string): string {
  return `conversation:${discordUserId}`;
}

// 🛡️ DỰ PHÒNG IN-MEMORY (Kích hoạt khi Redis hết Quota hoặc mất kết nối)
const localMemoryFallback = new Map<string, { messages: ConversationMessage[]; lastUpdated: number }>();

function getLocalHistory(discordUserId: string): ConversationMessage[] {
  const entry = localMemoryFallback.get(discordUserId);
  if (!entry) return [];

  if (Date.now() - entry.lastUpdated > TTL_MS) {
    localMemoryFallback.delete(discordUserId);
    return [];
  }

  entry.lastUpdated = Date.now();
  return [...entry.messages];
}

function addToLocalHistory(discordUserId: string, role: 'user' | 'model', content: string): void {
  const current = getLocalHistory(discordUserId);
  current.push({ role, content });

  const trimmed = current.slice(-MAX_MESSAGES_PER_USER);
  localMemoryFallback.set(discordUserId, {
    messages: trimmed,
    lastUpdated: Date.now(),
  });
}

function clearLocalHistory(discordUserId: string): void {
  localMemoryFallback.delete(discordUserId);
}

/**
 * Lấy lịch sử hội thoại của người dùng (Có cơ chế Fallback In-Memory an toàn 100%)
 */
export async function getConversationHistory(discordUserId: string): Promise<ConversationMessage[]> {
  try {
    const key = getRedisKey(discordUserId);
    const rawData = await redisClient.lrange(key, 0, -1);

    if (!rawData || rawData.length === 0) {
      // Nếu Redis rỗng, kiểm tra xem có dữ liệu trong fallback không
      return getLocalHistory(discordUserId);
    }

    // Refresh TTL
    await redisClient.expire(key, TTL_SECONDS).catch(() => {});

    return rawData.map((item) => JSON.parse(item) as ConversationMessage);
  } catch (err) {
    logger.warn('Redis unavailable in getConversationHistory, falling back to In-Memory store', {
      discordUserId,
      error: err instanceof Error ? err.message : String(err),
    });
    return getLocalHistory(discordUserId);
  }
}

/**
 * Thêm một tin nhắn vào lịch sử hội thoại (Có cơ chế Fallback In-Memory an toàn 100%)
 */
export async function addToConversation(
  discordUserId: string,
  role: 'user' | 'model',
  content: string
): Promise<void> {
  // Luôn cập nhật vào fallback local để đồng bộ
  addToLocalHistory(discordUserId, role, content);

  try {
    const key = getRedisKey(discordUserId);
    const messageData = JSON.stringify({ role, content });

    // Đẩy vào cuối mảng (Right Push)
    await redisClient.rpush(key, messageData);

    // Giữ tối đa N tin nhắn cuối cùng
    await redisClient.ltrim(key, -MAX_MESSAGES_PER_USER, -1);

    // Cập nhật TTL
    await redisClient.expire(key, TTL_SECONDS);
  } catch (err) {
    logger.warn('Redis unavailable in addToConversation, saved to In-Memory store only', {
      discordUserId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Xóa trắng lịch sử hội thoại của người dùng
 */
export async function clearConversation(discordUserId: string): Promise<void> {
  clearLocalHistory(discordUserId);

  try {
    const key = getRedisKey(discordUserId);
    await redisClient.del(key);
  } catch (err) {
    logger.warn('Redis unavailable in clearConversation', {
      discordUserId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Lấy số lượng tin nhắn hiện tại trong bộ nhớ của người dùng
 */
export async function getConversationMessageCount(discordUserId: string): Promise<number> {
  try {
    const key = getRedisKey(discordUserId);
    const count = await redisClient.llen(key);
    if (count > 0) return count;
    return getLocalHistory(discordUserId).length;
  } catch {
    return getLocalHistory(discordUserId).length;
  }
}

/**
 * Dọn dẹp các hội thoại local đã hết hạn
 */
export function pruneExpiredConversations(): number {
  const now = Date.now();
  let pruned = 0;

  for (const [userId, entry] of localMemoryFallback.entries()) {
    if (now - entry.lastUpdated > TTL_MS) {
      localMemoryFallback.delete(userId);
      pruned++;
    }
  }

  return pruned;
}
