import { execute } from '../../src/commands/hoi';
import { prisma } from '../../src/config/prisma';
import * as dbRateLimiter from '../../src/services/dbRateLimiter';
import * as conversationMemory from '../../src/services/conversationMemory';
import * as aiService from '../../src/services/aiService';

jest.mock('../../src/config/prisma', () => ({
  prisma: {
    user: {
      upsert: jest.fn().mockResolvedValue({ id: 'u1', discordUserId: 'discord-123' }),
    },
  },
}));

jest.mock('../../src/services/dbRateLimiter', () => ({
  checkDbRateLimit: jest.fn().mockResolvedValue({ allowed: true, remaining: 9 }),
  recordDbAiUsage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/conversationMemory', () => ({
  getConversationHistory: jest.fn().mockResolvedValue([]),
  addToConversation: jest.fn().mockResolvedValue(undefined),
  clearConversation: jest.fn().mockResolvedValue(undefined),
  getConversationMessageCount: jest.fn().mockResolvedValue(2),
}));

jest.mock('../../src/services/aiService', () => ({
  askAIWithVisualRouter: jest
    .fn()
    .mockResolvedValue({ textAnswer: 'Câu trả lời', hasVisual: false }),
}));

jest.mock('../../src/services/visualService', () => ({
  renderMermaidToBuffer: jest.fn(),
}));

jest.mock('../../src/workers/imageWorker', () => ({
  aiImageQueue: { add: jest.fn() },
}));

function makeInteraction(isNew: boolean): any {
  return {
    id: 'interaction-1',
    token: 'token',
    user: { id: 'discord-123', username: 'Student' },
    client: { user: { id: 'app-1' } },
    options: {
      getString: jest.fn().mockReturnValue('TCP là gì?'),
      getBoolean: jest.fn().mockReturnValue(isNew),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    deleteReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
  };
}

const order = (fn: unknown): number => (fn as jest.Mock).mock.invocationCallOrder[0] ?? Infinity;

describe('💡 /hoi Command — Discord 3s acknowledgement deadline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('defers the reply before any DB/Redis I/O so slow queries cannot cause Unknown interaction (10062)', async () => {
    const interaction = makeInteraction(true);

    await execute(interaction);

    const deferAt = order(interaction.deferReply);
    expect(deferAt).toBeLessThan(order(prisma.user.upsert));
    expect(deferAt).toBeLessThan(order(conversationMemory.clearConversation));
    expect(deferAt).toBeLessThan(order(dbRateLimiter.checkDbRateLimit));
  });

  it('reports rate-limit rejection privately after deferring', async () => {
    (dbRateLimiter.checkDbRateLimit as jest.Mock).mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      message: '⏳ Hết hạn mức',
    });
    const interaction = makeInteraction(false);

    await execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⏳ Hết hạn mức', ephemeral: true })
    );
  });

  it('keeps the delivered answer when a follow-up chunk fails', async () => {
    const longAnswer = 'câu trả lời dài. '.repeat(400);
    (aiService.askAIWithVisualRouter as jest.Mock).mockResolvedValueOnce({
      textAnswer: longAnswer,
      hasVisual: false,
    });
    const interaction = makeInteraction(false);
    interaction.followUp.mockRejectedValueOnce(new Error('followUp failed'));

    await execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledTimes(2);
    const calls = interaction.followUp.mock.calls;
    expect(calls[calls.length - 1][0]).toEqual(
      expect.objectContaining({
        ephemeral: true,
        content: expect.stringContaining('Không gửi được phần tiếp theo'),
      })
    );
  });

  it('still replaces the placeholder with the error when the AI call fails', async () => {
    (aiService.askAIWithVisualRouter as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const interaction = makeInteraction(false);

    await execute(interaction);

    expect(interaction.editReply).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: '❌ Có lỗi xảy ra khi gọi AI. Vui lòng thử lại sau.' })
    );
  });
});
