import { checkDbRateLimit, recordDbAiUsage, AI_LIMITS } from '../../src/services/dbRateLimiter';
import { prisma } from '../../src/config/prisma';

describe('dbRateLimiter', () => {
  const userId = 'user-rate-limit-test';

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { discordUserId: 'discord-rl-user' },
      update: {},
      create: { id: userId, discordUserId: 'discord-rl-user', username: 'rl_tester' },
    });
  });

  beforeEach(async () => {
    await prisma.aiUsageLog.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.aiUsageLog.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('allows access when usage is under limit', async () => {
    const result = await checkDbRateLimit(userId, 'AI_FLASHCARD');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(AI_LIMITS.AI_FLASHCARD.limitPerHour);
  });

  it('blocks access when limit is reached', async () => {
    const limit = AI_LIMITS.AI_FLASHCARD.limitPerHour;
    for (let i = 0; i < limit; i++) {
      await recordDbAiUsage(userId, 'AI_FLASHCARD');
    }

    const checkResult = await checkDbRateLimit(userId, 'AI_FLASHCARD');
    expect(checkResult.allowed).toBe(false);
    expect(checkResult.remaining).toBe(0);
    expect(checkResult.message).toContain('hạn mức');
  });

  it('ignores logs older than 1 hour', async () => {
    const limit = AI_LIMITS.AI_FLASHCARD.limitPerHour;
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    for (let i = 0; i < limit; i++) {
      await prisma.aiUsageLog.create({
        data: {
          userId,
          actionType: 'AI_FLASHCARD',
          createdAt: twoHoursAgo,
        },
      });
    }

    const checkResult = await checkDbRateLimit(userId, 'AI_FLASHCARD');
    expect(checkResult.allowed).toBe(true);
    expect(checkResult.remaining).toBe(AI_LIMITS.AI_FLASHCARD.limitPerHour);
  });
});
