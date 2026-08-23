import { redisClient } from '../config/redis';

export interface ConversationMessage {
  role: 'user' | 'model';
  content: string;
}

const MAX_MESSAGES_PER_USER = 10; // 5 cặp (User + Model)
const TTL_SECONDS = 30 * 60; // 30 phút

function getRedisKey(discordUserId: string): string {
  return `conversation:${discordUserId}`;
}

/**
 * Lấy lịch sử hội thoại của người dùng từ Redis
 */
export async function getConversationHistory(discordUserId: string): Promise<ConversationMessage[]> {
  const key = getRedisKey(discordUserId);
  const rawData = await redisClient.lrange(key, 0, -1);
  
  if (!rawData || rawData.length === 0) return [];
  
  // Refresh TTL
  await redisClient.expire(key, TTL_SECONDS);
  
  return rawData.map(item => JSON.parse(item) as ConversationMessage);
}

/**
 * Thêm một tin nhắn vào lịch sử hội thoại của người dùng
 */
export async function addToConversation(
  discordUserId: string,
  role: 'user' | 'model',
  content: string
): Promise<void> {
  const key = getRedisKey(discordUserId);
  const messageData = JSON.stringify({ role, content });

  // Đẩy vào cuối mảng (Right Push)
  await redisClient.rpush(key, messageData);
  
  // Giữ tối đa N tin nhắn cuối cùng
  await redisClient.ltrim(key, -MAX_MESSAGES_PER_USER, -1);
  
  // Cập nhật TTL
  await redisClient.expire(key, TTL_SECONDS);
}

/**
 * Xóa trắng lịch sử hội thoại của người dùng
 */
export async function clearConversation(discordUserId: string): Promise<void> {
  const key = getRedisKey(discordUserId);
  await redisClient.del(key);
}

/**
 * Lấy số lượng tin nhắn hiện tại trong bộ nhớ của người dùng
 */
export async function getConversationMessageCount(discordUserId: string): Promise<number> {
  const key = getRedisKey(discordUserId);
  return redisClient.llen(key);
}

/**
 * Compatibility shim (Redis handles TTL automatically)
 */
export function pruneExpiredConversations(): number {
  return 0;
}
