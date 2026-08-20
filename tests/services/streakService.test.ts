import { recordUserActivity } from '../../src/services/streakService';
import { prisma } from '../../src/config/prisma';

jest.mock('../../src/config/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('streakService', () => {
  const discordUserId = 'discord-streak-test-user';
  const username = 'StreakUser';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets streak to 1 for first time user activity (user not found in DB)', async () => {
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.user.create as jest.Mock).mockResolvedValue({
      id: 'u1',
      discordUserId,
      username,
      streakCount: 1,
      lastActiveDate: new Date(),
    });

    const result = await recordUserActivity(discordUserId, username);

    expect(result.streakCount).toBe(1);
    expect(result.action).toBe('RESET');
    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: {
        discordUserId,
        username,
        streakCount: 1,
        lastActiveDate: expect.any(Date),
      },
    });
  });

  it('maintains streak on same calendar day activity without unnecessary update', async () => {
    const today = new Date('2026-08-20T08:00:00+07:00');
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'u1',
      discordUserId,
      username,
      streakCount: 5,
      lastActiveDate: today,
    });

    const evening = new Date('2026-08-20T20:00:00+07:00');
    const result = await recordUserActivity(discordUserId, username, evening);

    expect(result.streakCount).toBe(5);
    expect(result.action).toBe('MAINTAIN');
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('increments streak on consecutive calendar days', async () => {
    const day1 = new Date('2026-08-19T20:00:00+07:00');
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'u1',
      discordUserId,
      username,
      streakCount: 3,
      lastActiveDate: day1,
    });
    (mockPrisma.user.update as jest.Mock).mockResolvedValue({
      id: 'u1',
      discordUserId,
      username,
      streakCount: 4,
      lastActiveDate: new Date('2026-08-20T09:00:00+07:00'),
    });

    const day2 = new Date('2026-08-20T09:00:00+07:00');
    const result = await recordUserActivity(discordUserId, username, day2);

    expect(result.streakCount).toBe(4);
    expect(result.action).toBe('INCREMENT');
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: {
        streakCount: 4,
        lastActiveDate: day2,
        username,
      },
    });
  });

  it('resets streak to 1 if user skips a day', async () => {
    const day1 = new Date('2026-08-17T10:00:00+07:00');
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'u1',
      discordUserId,
      username,
      streakCount: 10,
      lastActiveDate: day1,
    });
    (mockPrisma.user.update as jest.Mock).mockResolvedValue({
      id: 'u1',
      discordUserId,
      username,
      streakCount: 1,
      lastActiveDate: new Date('2026-08-20T10:00:00+07:00'),
    });

    const day3 = new Date('2026-08-20T10:00:00+07:00');
    const result = await recordUserActivity(discordUserId, username, day3);

    expect(result.streakCount).toBe(1);
    expect(result.action).toBe('RESET');
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: {
        streakCount: 1,
        lastActiveDate: day3,
        username,
      },
    });
  });
});
