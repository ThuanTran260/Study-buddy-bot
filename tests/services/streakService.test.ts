import { recordUserActivity } from '../../src/services/streakService';
import { prisma } from '../../src/config/prisma';

describe('streakService', () => {
  const discordUserId = 'discord-streak-test-user';

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { discordUserId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { discordUserId } });
    await prisma.$disconnect();
  });

  it('sets streak to 1 for first time user activity', async () => {
    const result = await recordUserActivity(discordUserId, 'StreakUser');
    expect(result.streakCount).toBe(1);
    expect(result.action).toBe('RESET');
  });

  it('maintains streak on same calendar day activity', async () => {
    const morning = new Date('2026-08-20T08:00:00+07:00');
    const evening = new Date('2026-08-20T20:00:00+07:00');

    await recordUserActivity(discordUserId, 'StreakUser', morning);
    const result = await recordUserActivity(discordUserId, 'StreakUser', evening);

    expect(result.streakCount).toBe(1);
    expect(result.action).toBe('MAINTAIN');
  });

  it('increments streak on consecutive calendar days', async () => {
    const day1 = new Date('2026-08-19T20:00:00+07:00');
    const day2 = new Date('2026-08-20T09:00:00+07:00');

    await recordUserActivity(discordUserId, 'StreakUser', day1);
    const result = await recordUserActivity(discordUserId, 'StreakUser', day2);

    expect(result.streakCount).toBe(2);
    expect(result.action).toBe('INCREMENT');
  });

  it('resets streak to 1 if user skips a day', async () => {
    const day1 = new Date('2026-08-17T10:00:00+07:00');
    const day3 = new Date('2026-08-19T10:00:00+07:00');

    await recordUserActivity(discordUserId, 'StreakUser', day1);
    const result = await recordUserActivity(discordUserId, 'StreakUser', day3);

    expect(result.streakCount).toBe(1);
    expect(result.action).toBe('RESET');
  });
});
