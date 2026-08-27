import {
  addToConversation,
  getConversationHistory,
  clearConversation,
  getConversationMessageCount,
  pruneExpiredConversations,
} from '../../src/services/conversationMemory';

describe('conversationMemory', () => {
  beforeEach(async () => {
    await clearConversation('user-1');
    await clearConversation('user-2');
  });

  it('stores and retrieves conversation history for a user', async () => {
    await addToConversation('user-1', 'user', 'Xin chào bot');
    await addToConversation('user-1', 'model', 'Chào bạn! Mình có thể giúp gì?');

    const history = await getConversationHistory('user-1');
    expect(history.length).toBe(2);
    expect(history[0]).toEqual({ role: 'user', content: 'Xin chào bot' });
    expect(history[1]).toEqual({ role: 'model', content: 'Chào bạn! Mình có thể giúp gì?' });
    expect(await getConversationMessageCount('user-1')).toBe(2);
  });

  it('caps history at 10 messages (5 dialog turns) with sliding window', async () => {
    for (let i = 1; i <= 12; i++) {
      await addToConversation('user-1', i % 2 === 1 ? 'user' : 'model', `Message ${i}`);
    }

    const history = await getConversationHistory('user-1');
    expect(history.length).toBe(10);
    // Oldest messages (1 and 2) should have been evicted
    expect(history[0].content).toBe('Message 3');
    expect(history[9].content).toBe('Message 12');
  });

  it('clears conversation on clearConversation call', async () => {
    await addToConversation('user-1', 'user', 'Câu hỏi 1');
    await clearConversation('user-1');
    expect(await getConversationHistory('user-1')).toEqual([]);
    expect(await getConversationMessageCount('user-1')).toBe(0);
  });

  it('pruneExpiredConversations cleans up expired entries', () => {
    const pruned = pruneExpiredConversations();
    expect(pruned).toBe(0);
  });

  describe('In-Memory Fallback Resilience (Redis Quota Exceeded)', () => {
    it('seamlessly falls back to In-Memory store when Redis throws Quota Exceeded', async () => {
      const { redisClient } = await import('../../src/config/redis');

      // Giả lập Redis ném lỗi Quota Exceeded
      const originalLrange = redisClient.lrange;
      const originalRpush = redisClient.rpush;
      jest.spyOn(redisClient, 'lrange').mockRejectedValue(new Error('ERR max daily request limit exceeded'));
      jest.spyOn(redisClient, 'rpush').mockRejectedValue(new Error('ERR max daily request limit exceeded'));

      // Thao tác không ném lỗi và tự động lưu vào In-Memory store
      await expect(addToConversation('user-fallback-1', 'user', 'Tin nhắn khi Redis hết quota')).resolves.not.toThrow();
      
      const history = await getConversationHistory('user-fallback-1');
      expect(history.length).toBe(1);
      expect(history[0].content).toBe('Tin nhắn khi Redis hết quota');

      expect(await getConversationMessageCount('user-fallback-1')).toBe(1);

      // Khôi phục
      jest.restoreAllMocks();
    });
  });
});
