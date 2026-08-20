import {
  addToConversation,
  getConversationHistory,
  clearConversation,
  getConversationMessageCount,
  pruneExpiredConversations,
} from '../../src/services/conversationMemory';

describe('conversationMemory', () => {
  beforeEach(() => {
    clearConversation('user-1');
    clearConversation('user-2');
  });

  it('stores and retrieves conversation history for a user', () => {
    addToConversation('user-1', 'user', 'Xin chào bot');
    addToConversation('user-1', 'model', 'Chào bạn! Mình có thể giúp gì?');

    const history = getConversationHistory('user-1');
    expect(history.length).toBe(2);
    expect(history[0]).toEqual({ role: 'user', content: 'Xin chào bot' });
    expect(history[1]).toEqual({ role: 'model', content: 'Chào bạn! Mình có thể giúp gì?' });
    expect(getConversationMessageCount('user-1')).toBe(2);
  });

  it('caps history at 10 messages (5 dialog turns) with sliding window', () => {
    for (let i = 1; i <= 12; i++) {
      addToConversation('user-1', i % 2 === 1 ? 'user' : 'model', `Message ${i}`);
    }

    const history = getConversationHistory('user-1');
    expect(history.length).toBe(10);
    // Oldest messages (1 and 2) should have been evicted
    expect(history[0].content).toBe('Message 3');
    expect(history[9].content).toBe('Message 12');
  });

  it('clears conversation on clearConversation call', () => {
    addToConversation('user-1', 'user', 'Câu hỏi 1');
    clearConversation('user-1');
    expect(getConversationHistory('user-1')).toEqual([]);
    expect(getConversationMessageCount('user-1')).toBe(0);
  });

  it('pruneExpiredConversations cleans up expired entries', () => {
    addToConversation('user-1', 'user', 'Message');
    const pruned = pruneExpiredConversations();
    // Newly added item should not be pruned immediately
    expect(pruned).toBe(0);
  });
});
