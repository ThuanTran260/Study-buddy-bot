import { execute } from '../../src/commands/tomtat';
import { prisma } from '../../src/config/prisma';
import * as dbRateLimiter from '../../src/services/dbRateLimiter';
import * as aiService from '../../src/services/aiService';
import { sendEphemeralAfterDefer } from '../../src/utils/interactionReply';

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

jest.mock('../../src/services/aiService', () => ({
  summarizeText: jest.fn().mockResolvedValue('Tóm tắt ngắn'),
}));

jest.mock('../../src/utils/interactionReply', () => ({
  sendEphemeralAfterDefer: jest.fn().mockResolvedValue(undefined),
}));

function makeInteraction(): any {
  return {
    user: { id: 'discord-123', username: 'Student' },
    options: {
      getString: jest.fn().mockReturnValue('Nội dung cần tóm tắt'),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
  };
}

const order = (fn: unknown): number => (fn as jest.Mock).mock.invocationCallOrder[0] ?? Infinity;

describe('📝 /tomtat Command — Discord 3s acknowledgement deadline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('defers before user upsert and rate-limit check', async () => {
    const interaction = makeInteraction();

    await execute(interaction);

    const deferAt = order(interaction.deferReply);
    expect(deferAt).toBeLessThan(order(prisma.user.upsert));
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

  it('keeps the delivered answer when a follow-up chunk fails', async () => {
    const longSummary = 'câu trả lời dài. '.repeat(400);
    (aiService.summarizeText as jest.Mock).mockResolvedValueOnce(longSummary);
    const interaction = makeInteraction();
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
    (aiService.summarizeText as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const interaction = makeInteraction();

    await execute(interaction);

    expect(interaction.editReply).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: expect.stringContaining('❌ Không thể tóm tắt văn bản') })
    );
  });
});
