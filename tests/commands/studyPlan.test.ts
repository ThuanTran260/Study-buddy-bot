import { execute } from '../../src/commands/study-plan';
import { prisma } from '../../src/config/prisma';
import * as aiService from '../../src/services/aiService';
import * as dbRateLimiter from '../../src/services/dbRateLimiter';
import { sendEphemeralAfterDefer } from '../../src/utils/interactionReply';

jest.mock('../../src/config/prisma', () => ({
  prisma: {
    user: {
      upsert: jest.fn(),
    },
    aiUsageLog: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'log-1' }),
    },
    quizSession: {
      findMany: jest.fn(),
    },
    flashcard: {
      findMany: jest.fn(),
    },
    pomodoroSession: {
      findMany: jest.fn(),
    },
    flashcardDeck: {
      count: jest.fn(),
    },
  },
}));

jest.mock('../../src/services/aiService', () => ({
  generateStudyPlanAI: jest
    .fn()
    .mockResolvedValue(
      '📊 **1. Đánh giá Hiệu suất**\n• Bạn duy trì tốt thói quen học.\n\n⚠️ **2. Ưu tiên Ôn tập**\n• Môn C++ cần làm thêm bài.\n\n📅 **3. Lịch trình 7 Ngày**\n• Thứ 2: Ôn C++\n• Thứ 3: Flashcard\n\n🍅 **4. Chiến lược Pomodoro**\n• 4 phiên/ngày.'
    ),
}));

jest.mock('../../src/services/dbRateLimiter', () => ({
  checkDbRateLimit: jest.fn().mockResolvedValue({ allowed: true, remaining: 3 }),
  recordDbAiUsage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/utils/interactionReply', () => ({
  sendEphemeralAfterDefer: jest.fn().mockResolvedValue(undefined),
}));

const order = (fn: unknown): number => (fn as jest.Mock).mock.invocationCallOrder[0] ?? Infinity;

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('📅 /study-plan Command & AI Study Advisor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hướng dẫn người dùng mới khi chưa có dữ liệu học tập 14 ngày qua', async () => {
    (mockPrisma.user.upsert as jest.Mock).mockResolvedValue({
      id: 'u1',
      discordUserId: 'discord-123',
      username: 'NewStudent',
      streakCount: 0,
    });

    (mockPrisma.quizSession.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.flashcard.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.pomodoroSession.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.flashcardDeck.count as jest.Mock).mockResolvedValue(0);

    const mockInteraction: any = {
      user: { id: 'discord-123', username: 'NewStudent' },
      options: { getString: jest.fn().mockReturnValue(null) },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    };

    await execute(mockInteraction);

    expect(mockInteraction.deferReply).toHaveBeenCalled();
    expect(mockInteraction.editReply).toHaveBeenCalled();
    const editPayload = mockInteraction.editReply.mock.calls[0][0];
    expect(editPayload.embeds[0].data.title).toContain('Chào Mừng Bạn Đến Với AI Study Planner');
  });

  it('tổng hợp dữ liệu định lượng và gọi AI sinh kế hoạch 7 ngày thành công', async () => {
    (mockPrisma.user.upsert as jest.Mock).mockResolvedValue({
      id: 'u1',
      discordUserId: 'discord-123',
      username: 'ThuanTran',
      streakCount: 5,
    });

    (mockPrisma.quizSession.findMany as jest.Mock).mockResolvedValue([
      { topic: 'TypeScript', totalQuestions: 4, correctAnswers: 3, createdAt: new Date() },
    ]);
    (mockPrisma.flashcard.findMany as jest.Mock).mockResolvedValue([
      { front: 'NextJS DAL', easeFactor: 1.5, deck: { name: 'Security' } },
    ]);
    (mockPrisma.pomodoroSession.findMany as jest.Mock).mockResolvedValue([
      { workMinutes: 25, status: 'BREAK' },
      { workMinutes: 25, status: 'BREAK' },
    ]);
    (mockPrisma.flashcardDeck.count as jest.Mock).mockResolvedValue(3);

    const mockInteraction: any = {
      user: { id: 'discord-123', username: 'ThuanTran' },
      options: { getString: jest.fn().mockReturnValue('Ôn thi giữa kỳ') },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    };

    await execute(mockInteraction);

    expect(aiService.generateStudyPlanAI).toHaveBeenCalled();
    const passedContext = (aiService.generateStudyPlanAI as jest.Mock).mock.calls[0][0];
    expect(passedContext).toContain('TypeScript');
    expect(passedContext).toContain('NextJS DAL');
    expect(passedContext).toContain('Ôn thi giữa kỳ');

    expect(mockInteraction.editReply).toHaveBeenCalled();
    const editPayload = mockInteraction.editReply.mock.calls[0][0];
    expect(editPayload.embeds[0].data.title).toContain('Lộ Trình Học Tập Cá Nhân Hóa 7 Ngày');
  });

  describe('Discord 3s acknowledgement deadline', () => {
    function makeInteraction(): any {
      return {
        user: { id: 'discord-123', username: 'Student' },
        options: { getString: jest.fn().mockReturnValue(null) },
        deferReply: jest.fn().mockResolvedValue(undefined),
        reply: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(undefined),
      };
    }

    beforeEach(() => {
      (mockPrisma.user.upsert as jest.Mock).mockResolvedValue({
        id: 'u1',
        discordUserId: 'discord-123',
        username: 'Student',
        streakCount: 0,
      });
      (mockPrisma.quizSession.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.flashcard.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.pomodoroSession.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.flashcardDeck.count as jest.Mock).mockResolvedValue(0);
    });

    it('defers before user upsert and rate-limit check', async () => {
      const interaction = makeInteraction();

      await execute(interaction);

      const deferAt = order(interaction.deferReply);
      expect(deferAt).toBeLessThan(order(mockPrisma.user.upsert));
      expect(deferAt).toBeLessThan(order(dbRateLimiter.checkDbRateLimit));
    });

    it('sends rate-limit rejection privately after deferring', async () => {
      (dbRateLimiter.checkDbRateLimit as jest.Mock).mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        message: '⏳ X',
      });
      const interaction = makeInteraction();

      await execute(interaction);

      expect(interaction.deferReply).toHaveBeenCalledTimes(1);
      expect(sendEphemeralAfterDefer).toHaveBeenCalledWith(interaction, '⏳ X');
      expect(interaction.reply).not.toHaveBeenCalled();
    });
  });
});
