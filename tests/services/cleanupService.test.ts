import { cleanupOldAiUsageLogs } from '../../src/services/cleanupService';
import { prisma } from '../../src/config/prisma';

describe('cleanupOldAiUsageLogs', () => {
  const userId = 'user-cleanup-test-id';

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { discordUserId: 'discord-cleanup-test' },
      update: {},
      create: { id: userId, discordUserId: 'discord-cleanup-test', username: 'cleanup_user' },
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

  it('xóa record cũ hơn 24h', async () => {
    await prisma.aiUsageLog.create({
      data: {
        userId,
        actionType: 'AI_QUESTION',
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25h trước
      },
    });

    const { deletedCount } = await cleanupOldAiUsageLogs();
    expect(deletedCount).toBe(1);
    expect(await prisma.aiUsageLog.count({ where: { userId } })).toBe(0);
  });

  it('KHÔNG xóa record trong vòng 24h gần đây', async () => {
    await prisma.aiUsageLog.create({
      data: {
        userId,
        actionType: 'AI_QUESTION',
        createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1h trước
      },
    });

    const { deletedCount } = await cleanupOldAiUsageLogs();
    expect(deletedCount).toBe(0);
    expect(await prisma.aiUsageLog.count({ where: { userId } })).toBe(1);
  });
});
