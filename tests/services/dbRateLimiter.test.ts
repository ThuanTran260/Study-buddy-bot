import { checkDbRateLimit, recordDbAiUsage, AI_LIMITS } from '../../src/services/dbRateLimiter';
import { prisma } from '../../src/config/prisma';

jest.mock('../../src/config/prisma', () => ({
  prisma: {
    aiUsageLog: {
      count: jest.fn(),
      create: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('dbRateLimiter', () => {
  const userId = 'user-rate-limit-test';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows access when usage count is under limit', async () => {
    (mockPrisma.aiUsageLog.count as jest.Mock).mockResolvedValue(0);

    const result = await checkDbRateLimit(userId, 'AI_FLASHCARD');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(AI_LIMITS.AI_FLASHCARD.limitPerHour);
    expect(mockPrisma.aiUsageLog.count).toHaveBeenCalledWith({
      where: {
        userId,
        actionType: 'AI_FLASHCARD',
        createdAt: {
          gte: expect.any(Date),
        },
      },
    });
  });

  it('blocks access when limit is reached', async () => {
    const limit = AI_LIMITS.AI_FLASHCARD.limitPerHour;
    (mockPrisma.aiUsageLog.count as jest.Mock).mockResolvedValue(limit);

    const checkResult = await checkDbRateLimit(userId, 'AI_FLASHCARD');
    expect(checkResult.allowed).toBe(false);
    expect(checkResult.remaining).toBe(0);
    expect(checkResult.message).toContain('hạn mức');
  });

  it('records AI usage log in database', async () => {
    (mockPrisma.aiUsageLog.create as jest.Mock).mockResolvedValue({
      id: 'log-1',
      userId,
      actionType: 'AI_FLASHCARD',
      createdAt: new Date(),
    });

    await recordDbAiUsage(userId, 'AI_FLASHCARD');

    expect(mockPrisma.aiUsageLog.create).toHaveBeenCalledWith({
      data: {
        userId,
        actionType: 'AI_FLASHCARD',
      },
    });
  });
});
