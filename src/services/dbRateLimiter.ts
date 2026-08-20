import { prisma } from '../config/prisma';

export type AiActionType = 'AI_QUESTION' | 'AI_SUMMARIZE' | 'AI_QUIZ' | 'AI_FLASHCARD';

export const AI_LIMITS: Record<AiActionType, { limitPerHour: number; name: string }> = {
  AI_QUESTION: { limitPerHour: 10, name: 'Hỏi đáp AI' },
  AI_SUMMARIZE: { limitPerHour: 10, name: 'Tóm tắt AI' },
  AI_QUIZ: { limitPerHour: 5, name: 'Tạo Quiz AI' },
  AI_FLASHCARD: { limitPerHour: 5, name: 'Tạo Flashcard AI' },
};

export async function checkDbRateLimit(
  userId: string,
  actionType: AiActionType
): Promise<{ allowed: boolean; remaining: number; message?: string }> {
  const config = AI_LIMITS[actionType];
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const usageCount = await prisma.aiUsageLog.count({
    where: {
      userId,
      actionType,
      createdAt: { gte: oneHourAgo },
    },
  });

  if (usageCount >= config.limitPerHour) {
    return {
      allowed: false,
      remaining: 0,
      message: `⏳ Bạn đã dùng hết hạn mức ${config.name} (${config.limitPerHour} lần/giờ). Vui lòng thử lại sau.`,
    };
  }

  return {
    allowed: true,
    remaining: config.limitPerHour - usageCount,
  };
}

export async function recordDbAiUsage(userId: string, actionType: AiActionType): Promise<void> {
  await prisma.aiUsageLog.create({
    data: {
      userId,
      actionType,
    },
  });
}
