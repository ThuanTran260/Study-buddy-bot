import {
  buildDailyReminderEmbed,
  buildDailyReminderComponents,
  sendDailyFlashcardReminder,
} from '../../src/services/dailyReminderService';
import { prisma } from '../../src/config/prisma';
import { Client } from 'discord.js';

jest.mock('../../src/config/prisma', () => ({
  prisma: {
    user: {
      findMany: jest.fn(),
    },
  },
}));

describe('dailyReminderService', () => {
  describe('buildDailyReminderEmbed', () => {
    it('creates an embed with username, dueCount and deck summary', () => {
      const embed = buildDailyReminderEmbed('ThuanTran', 8, [
        { name: 'Tiếng Anh B2', count: 5 },
        { name: 'Lập Trình TypeScript', count: 3 },
      ]);

      expect(embed.data.title).toContain('Nhắc Nhở Ôn Tập Flashcard Buổi Sáng');
      expect(embed.data.description).toContain('ThuanTran');
      expect(embed.data.description).toContain('8 thẻ');
      expect(embed.data.description).toContain('Tiếng Anh B2');
      expect(embed.data.description).toContain('Lập Trình TypeScript');
      expect(embed.data.color).toBe(0x57f287);
    });
  });

  describe('buildDailyReminderComponents', () => {
    it('creates an ActionRow containing disable button with customId disable_daily_reminder', () => {
      const row = buildDailyReminderComponents();
      expect(row.components.length).toBe(1);
      expect((row.components[0].data as any).custom_id).toBe('disable_daily_reminder');
      expect((row.components[0].data as any).label).toContain('Tắt Nhắc Nhở');
    });
  });

  describe('sendDailyFlashcardReminder', () => {
    it('sends DM to user with due cards and returns sent count', async () => {
      const mockFindMany = prisma.user.findMany as jest.Mock;
      mockFindMany.mockResolvedValueOnce([
        {
          discordUserId: 'user-123',
          username: 'ThuanTran',
          dailyReminderEnabled: true,
          flashcardDecks: [
            {
              name: 'English',
              cards: [{ id: 'card-1' }, { id: 'card-2' }],
            },
          ],
        },
      ]);

      const mockSend = jest.fn().mockResolvedValue(undefined);
      const mockClient = {
        users: {
          fetch: jest.fn().mockResolvedValue({
            send: mockSend,
          }),
        },
      } as unknown as Client;

      const count = await sendDailyFlashcardReminder(mockClient);
      expect(count).toBe(1);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('skips users when due count is 0', async () => {
      const mockFindMany = prisma.user.findMany as jest.Mock;
      mockFindMany.mockResolvedValueOnce([
        {
          discordUserId: 'user-456',
          username: 'EmptyUser',
          dailyReminderEnabled: true,
          flashcardDecks: [
            {
              name: 'EmptyDeck',
              cards: [],
            },
          ],
        },
      ]);

      const mockSend = jest.fn();
      const mockClient = {
        users: {
          fetch: jest.fn().mockResolvedValue({
            send: mockSend,
          }),
        },
      } as unknown as Client;

      const count = await sendDailyFlashcardReminder(mockClient);
      expect(count).toBe(0);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });
});
