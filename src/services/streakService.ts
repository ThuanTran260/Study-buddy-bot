import { prisma } from '../config/prisma';
import { calculateStreakUpdate } from '../utils/dateUtils';
import { logger } from '../utils/logger';

export async function recordUserActivity(
  discordUserId: string,
  username?: string,
  currentDate: Date = new Date()
): Promise<{ streakCount: number; action: string }> {
  try {
    const existingUser = await prisma.user.findUnique({
      where: { discordUserId },
    });

    if (!existingUser) {
      await prisma.user.create({
        data: {
          discordUserId,
          username: username || 'Unknown',
          streakCount: 1,
          lastActiveDate: currentDate,
        },
      });
      return { streakCount: 1, action: 'RESET' };
    }

    const { action, nextStreak } = calculateStreakUpdate(existingUser.lastActiveDate, currentDate);

    if (action === 'MAINTAIN') {
      if (username && username !== existingUser.username) {
        await prisma.user.update({ where: { id: existingUser.id }, data: { username } });
      }
      return { streakCount: existingUser.streakCount, action };
    }

    const updatedStreak = action === 'INCREMENT' ? existingUser.streakCount + 1 : nextStreak;

    await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        username: username || undefined,
        streakCount: updatedStreak,
        lastActiveDate: currentDate,
      },
    });

    return { streakCount: updatedStreak, action };
  } catch (error) {
    logger.error('Error in recordUserActivity', { discordUserId, error: String(error) });
    return { streakCount: 0, action: 'ERROR' };
  }
}
