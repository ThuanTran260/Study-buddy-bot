import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';

const RETENTION_HOURS = 24;

export async function cleanupOldAiUsageLogs(): Promise<{ deletedCount: number }> {
  const cutoff = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000);

  const result = await prisma.aiUsageLog.deleteMany({
    where: {
      createdAt: { lt: cutoff },
    },
  });

  logger.info(`[Cleanup] Đã xóa ${result.count} bản ghi AiUsageLog cũ hơn ${RETENTION_HOURS}h`);
  return { deletedCount: result.count };
}
