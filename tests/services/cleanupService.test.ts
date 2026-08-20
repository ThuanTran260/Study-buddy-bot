import { cleanupOldAiUsageLogs } from '../../src/services/cleanupService';
import { prisma } from '../../src/config/prisma';

jest.mock('../../src/config/prisma', () => ({
  prisma: {
    aiUsageLog: {
      deleteMany: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('cleanupOldAiUsageLogs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('xóa record cũ hơn 24h và trả về số lượng record đã xóa', async () => {
    (mockPrisma.aiUsageLog.deleteMany as jest.Mock).mockResolvedValue({ count: 5 });

    const { deletedCount } = await cleanupOldAiUsageLogs();

    expect(deletedCount).toBe(5);
    expect(mockPrisma.aiUsageLog.deleteMany).toHaveBeenCalledWith({
      where: {
        createdAt: {
          lt: expect.any(Date),
        },
      },
    });
  });

  it('trả về 0 khi không có record nào cần xóa', async () => {
    (mockPrisma.aiUsageLog.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

    const { deletedCount } = await cleanupOldAiUsageLogs();

    expect(deletedCount).toBe(0);
    expect(mockPrisma.aiUsageLog.deleteMany).toHaveBeenCalledTimes(1);
  });
});
