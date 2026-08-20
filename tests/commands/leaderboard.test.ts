import { getLeaderboardData } from '../../src/commands/leaderboard';
import { prisma } from '../../src/config/prisma';

jest.mock('../../src/config/prisma', () => ({
  prisma: {
    user: {
      findMany: jest.fn(),
    },
  },
}));

describe('Leaderboard Service Logic', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty array when guildMemberIds is empty', async () => {
    const result = await getLeaderboardData([], 'streak');
    expect(result).toEqual([]);
  });

  describe('streak leaderboard', () => {
    it('queries users with streakCount > 0 in guild member list', async () => {
      const mockFindMany = prisma.user.findMany as jest.Mock;
      mockFindMany.mockResolvedValueOnce([
        { discordUserId: 'u1', username: 'Alice', streakCount: 10 },
        { discordUserId: 'u2', username: 'Bob', streakCount: 5 },
      ]);

      const result = await getLeaderboardData(['u1', 'u2'], 'streak');
      expect(result.length).toBe(2);
      expect(result[0].username).toBe('Alice');
      expect(result[0].score).toBe(10);
      expect(result[0].extraText).toContain('10 ngày liên tiếp');
    });
  });

  describe('quiz leaderboard', () => {
    it('aggregates quiz sessions and accuracy', async () => {
      const mockFindMany = prisma.user.findMany as jest.Mock;
      mockFindMany.mockResolvedValueOnce([
        {
          discordUserId: 'u1',
          username: 'Alice',
          quizSessions: [
            { totalQuestions: 5, correctAnswers: 5 },
            { totalQuestions: 5, correctAnswers: 4 },
          ],
        },
        {
          discordUserId: 'u2',
          username: 'Bob',
          quizSessions: [{ totalQuestions: 10, correctAnswers: 5 }],
        },
      ]);

      const result = await getLeaderboardData(['u1', 'u2'], 'quiz');
      expect(result.length).toBe(2);
      expect(result[0].username).toBe('Alice');
      expect(result[0].score).toBe(2);
      expect(result[0].extraText).toContain('90%');
    });
  });

  describe('pomodoro leaderboard', () => {
    it('aggregates pomodoro minutes correctly', async () => {
      const mockFindMany = prisma.user.findMany as jest.Mock;
      mockFindMany.mockResolvedValueOnce([
        {
          discordUserId: 'u1',
          username: 'Alice',
          pomodoroSessions: [{ workMinutes: 25 }, { workMinutes: 50 }],
        },
      ]);

      const result = await getLeaderboardData(['u1'], 'pomodoro');
      expect(result.length).toBe(1);
      expect(result[0].score).toBe(75);
      expect(result[0].extraText).toContain('1.3 giờ (75 phút)');
    });
  });

  describe('flashcard leaderboard', () => {
    it('counts cards with repetition >= 3', async () => {
      const mockFindMany = prisma.user.findMany as jest.Mock;
      mockFindMany.mockResolvedValueOnce([
        {
          discordUserId: 'u1',
          username: 'Alice',
          flashcardDecks: [
            {
              cards: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
            },
          ],
        },
      ]);

      const result = await getLeaderboardData(['u1'], 'flashcard');
      expect(result.length).toBe(1);
      expect(result[0].score).toBe(3);
      expect(result[0].extraText).toContain('3 thẻ thuộc lòng');
    });
  });
});
