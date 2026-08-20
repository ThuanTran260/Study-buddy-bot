export interface ConversationMessage {
  role: 'user' | 'model';
  content: string;
}

export interface ConversationEntry {
  messages: ConversationMessage[];
  lastAccessed: number;
}

const MAX_USERS = 200;
const MAX_MESSAGES_PER_USER = 10; // 5 cặp (User + Model)
const TTL_MS = 30 * 60 * 1000; // 30 phút

// In-Memory LRU Cache
const conversationCache = new Map<string, ConversationEntry>();

/**
 * Lấy lịch sử hội thoại của người dùng (tự động kiểm tra TTL)
 */
export function getConversationHistory(discordUserId: string): ConversationMessage[] {
  const entry = conversationCache.get(discordUserId);
  if (!entry) return [];

  const now = Date.now();
  // 🛡️ Lazy TTL Eviction: Tự hủy nếu phiên đã quá 30 phút không hoạt động
  if (now - entry.lastAccessed > TTL_MS) {
    conversationCache.delete(discordUserId);
    return [];
  }

  // Cập nhật thời điểm truy cập gần nhất (LRU tracking)
  entry.lastAccessed = now;
  return entry.messages;
}

/**
 * Thêm một tin nhắn vào lịch sử hội thoại của người dùng
 */
export function addToConversation(
  discordUserId: string,
  role: 'user' | 'model',
  content: string
): void {
  const now = Date.now();
  let entry = conversationCache.get(discordUserId);

  if (!entry) {
    // 🛡️ LRU Eviction: Nếu số lượng người dùng vượt 200, xóa entry cũ nhất
    if (conversationCache.size >= MAX_USERS) {
      const oldestKey = conversationCache.keys().next().value;
      if (oldestKey) conversationCache.delete(oldestKey);
    }

    entry = {
      messages: [],
      lastAccessed: now,
    };
    conversationCache.set(discordUserId, entry);
  }

  entry.messages.push({ role, content });
  entry.lastAccessed = now;

  // 🛡️ Giữ tối đa 10 tin nhắn (5 lượt đối thoại)
  if (entry.messages.length > MAX_MESSAGES_PER_USER) {
    entry.messages = entry.messages.slice(-MAX_MESSAGES_PER_USER);
  }
}

/**
 * Xóa trắng lịch sử hội thoại của người dùng
 */
export function clearConversation(discordUserId: string): void {
  conversationCache.delete(discordUserId);
}

/**
 * Lấy số lượng tin nhắn hiện tại trong bộ nhớ của người dùng
 */
export function getConversationMessageCount(discordUserId: string): number {
  const entry = conversationCache.get(discordUserId);
  if (!entry) return 0;
  if (Date.now() - entry.lastAccessed > TTL_MS) {
    conversationCache.delete(discordUserId);
    return 0;
  }
  return entry.messages.length;
}

/**
 * Quét dọn dẹp các phiên hội thoại hết hạn định kỳ
 */
export function pruneExpiredConversations(): number {
  const now = Date.now();
  let deletedCount = 0;
  for (const [userId, entry] of conversationCache.entries()) {
    if (now - entry.lastAccessed > TTL_MS) {
      conversationCache.delete(userId);
      deletedCount++;
    }
  }
  return deletedCount;
}

// 🛡️ Batch Cleanup: Tự động chạy mỗi 10 phút một lần để giải phóng RAM
if (process.env.NODE_ENV !== 'test') {
  const timer = setInterval(() => {
    pruneExpiredConversations();
  }, 10 * 60 * 1000);
  timer.unref(); // Không chặn tiến trình tắt bot
}
