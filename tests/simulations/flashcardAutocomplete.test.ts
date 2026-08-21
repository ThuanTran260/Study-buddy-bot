import { autocomplete } from '../../src/commands/flashcard';
import { prisma } from '../../src/config/prisma';

jest.mock('../../src/config/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    flashcardDeck: {
      findMany: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('⚡ FLASHCARD AUTOCOMPLETE & DEFENSIVE TESTING', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Case 1: Trả về [] ngay lập tức khi User chưa có trong CSDL (Không gây Write-Spam)', async () => {
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    const mockInteraction: any = {
      user: { id: 'unknown-discord-user' },
      options: {
        getFocused: jest.fn().mockReturnValue({ name: 'ten_bo_the', value: 'sec' }),
      },
      respond: jest.fn().mockResolvedValue(undefined),
      responded: false,
    };

    await autocomplete(mockInteraction);

    expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    expect(mockPrisma.flashcardDeck.findMany).not.toHaveBeenCalled();
  });

  it('Case 2: Giới hạn tối đa 25 choices dù người dùng có hơn 30 bộ thẻ (Tránh lỗi 50035)', async () => {
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-1' });

    // Tạo 30 bộ thẻ giả lập
    const mockDecks = Array.from({ length: 30 }, (_, i) => ({
      name: `Deck_${i + 1}`,
      _count: { cards: 5 },
      cards: [{ id: `card-${i}` }],
    }));

    (mockPrisma.flashcardDeck.findMany as jest.Mock).mockResolvedValue(mockDecks.slice(0, 25));

    const mockInteraction: any = {
      user: { id: 'user-123' },
      options: {
        getFocused: jest.fn().mockReturnValue({ name: 'ten_bo_the', value: '' }),
      },
      respond: jest.fn().mockResolvedValue(undefined),
      responded: false,
    };

    await autocomplete(mockInteraction);

    expect(mockInteraction.respond).toHaveBeenCalled();
    const passedChoices = mockInteraction.respond.mock.calls[0][0];
    expect(passedChoices.length).toBeLessThanOrEqual(25);
  });

  it('Case 3: Cắt gọt nhãn label và value dưới 100 ký tự (Tránh lỗi Discord Payload Overflow)', async () => {
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-1' });

    const veryLongDeckName = 'A'.repeat(95);
    (mockPrisma.flashcardDeck.findMany as jest.Mock).mockResolvedValue([
      {
        name: veryLongDeckName,
        _count: { cards: 10 },
        cards: [{ id: 'c1' }, { id: 'c2' }],
      },
    ]);

    const mockInteraction: any = {
      user: { id: 'user-123' },
      options: {
        getFocused: jest.fn().mockReturnValue({ name: 'ten_bo_the', value: 'A' }),
      },
      respond: jest.fn().mockResolvedValue(undefined),
      responded: false,
    };

    await autocomplete(mockInteraction);

    expect(mockInteraction.respond).toHaveBeenCalled();
    const choices = mockInteraction.respond.mock.calls[0][0];
    expect(choices[0].name.length).toBeLessThanOrEqual(100);
    expect(choices[0].value.length).toBeLessThanOrEqual(100);
  });

  it('Case 4: Hiển thị badge 🔥 khi có thẻ đến hạn và ✅ khi đã hoàn thành', async () => {
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-1' });

    (mockPrisma.flashcardDeck.findMany as jest.Mock).mockResolvedValue([
      {
        name: 'Deck_Due',
        _count: { cards: 5 },
        cards: [{ id: 'c1' }, { id: 'c2' }], // 2 thẻ đến hạn
      },
      {
        name: 'Deck_Done',
        _count: { cards: 5 },
        cards: [], // 0 thẻ đến hạn
      },
    ]);

    const mockInteraction: any = {
      user: { id: 'user-123' },
      options: {
        getFocused: jest.fn().mockReturnValue({ name: 'ten_bo_the', value: '' }),
      },
      respond: jest.fn().mockResolvedValue(undefined),
      responded: false,
    };

    await autocomplete(mockInteraction);

    const choices = mockInteraction.respond.mock.calls[0][0];
    expect(choices[0].name).toContain('🔥 2 cần ôn');
    expect(choices[1].name).toContain('✅');
  });

  it('Case 5: Không throw lỗi ra ngoài khi database bị gián đoạn (Graceful Degradation)', async () => {
    (mockPrisma.user.findUnique as jest.Mock).mockRejectedValue(new Error('DB_DOWN'));

    const mockInteraction: any = {
      user: { id: 'user-123' },
      options: {
        getFocused: jest.fn().mockReturnValue({ name: 'ten_bo_the', value: 'test' }),
      },
      respond: jest.fn().mockResolvedValue(undefined),
      responded: false,
    };

    await expect(autocomplete(mockInteraction)).resolves.not.toThrow();
    expect(mockInteraction.respond).toHaveBeenCalledWith([]);
  });
});
