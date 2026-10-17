import { execute } from '../../src/commands/hoi';
import { prisma } from '../../src/config/prisma';
import * as dbRateLimiter from '../../src/services/dbRateLimiter';
import * as conversationMemory from '../../src/services/conversationMemory';

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

  it('reports rate-limit rejection via editReply after deferring (no second reply)', async () => {
    (dbRateLimiter.checkDbRateLimit as jest.Mock).mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      message: '⏳ Hết hạn mức',
    });
    const interaction = makeInteraction(false);

    await execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⏳ Hết hạn mức' })
    );
  });
});
