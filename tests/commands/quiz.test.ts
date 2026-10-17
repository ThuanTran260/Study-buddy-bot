import { execute } from '../../src/commands/quiz';
import { prisma } from '../../src/config/prisma';
import * as dbRateLimiter from '../../src/services/dbRateLimiter';
import * as aiService from '../../src/services/aiService';

jest.mock('../../src/config/prisma', () => ({
  prisma: {
    user: {
      upsert: jest.fn().mockResolvedValue({ id: 'u1', discordUserId: 'discord-123' }),
    },
    guild: { upsert: jest.fn().mockResolvedValue({ id: 'g1' }) },
    quizSession: {
      create: jest.fn().mockResolvedValue({ id: 's1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    quizQuestion: { create: jest.fn().mockResolvedValue({}) },
  },
}));

jest.mock('../../src/services/dbRateLimiter', () => ({
  checkDbRateLimit: jest.fn().mockResolvedValue({ allowed: true, remaining: 9 }),
  recordDbAiUsage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/aiService', () => ({
  generateQuizJson: jest.fn().mockRejectedValue(new Error('AI_DOWN')),
  parseAIJsonResponse: jest.fn(),
}));

jest.mock('../../src/services/streakService', () => ({
  recordUserActivity: jest.fn().mockResolvedValue(undefined),
}));

function makeInteraction(topic: string): any {
  return {
    id: 'interaction-1',
    token: 'token',
    guildId: 'guild-1',
    user: { id: 'discord-123', username: 'Student' },
    client: { user: { id: 'app-1' } },
    options: {
      getString: jest.fn().mockReturnValue(topic),
      getInteger: jest.fn().mockReturnValue(null),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    deleteReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
  };
}

const order = (fn: unknown): number => (fn as jest.Mock).mock.invocationCallOrder[0] ?? Infinity;

describe('📝 /quiz Command — Discord 3s acknowledgement deadline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (aiService.generateQuizJson as jest.Mock).mockRejectedValue(new Error('AI_DOWN'));
  });

  it('rejects an invalid topic ephemerally without touching the DB', async () => {
    const interaction = makeInteraction('');

    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(prisma.user.upsert).not.toHaveBeenCalled();
    expect(dbRateLimiter.checkDbRateLimit).not.toHaveBeenCalled();
  });

  it('defers before user upsert and rate-limit check', async () => {
    const interaction = makeInteraction('TCP/IP');

    await execute(interaction);

    const deferAt = order(interaction.deferReply);
    expect(deferAt).toBeLessThan(order(prisma.user.upsert));
    expect(deferAt).toBeLessThan(order(dbRateLimiter.checkDbRateLimit));
  });

  it('sends rate-limit rejection privately after deferring', async () => {
    (dbRateLimiter.checkDbRateLimit as jest.Mock).mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      message: '⏳ Hết hạn mức',
    });
    const interaction = makeInteraction('TCP/IP');

    await execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⏳ Hết hạn mức', ephemeral: true })
    );
    expect(aiService.generateQuizJson).not.toHaveBeenCalled();
  });
});
