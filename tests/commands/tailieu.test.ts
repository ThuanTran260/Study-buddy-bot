import { execute } from '../../src/commands/tailieu';
import { prisma } from '../../src/config/prisma';
import * as dbRateLimiter from '../../src/services/dbRateLimiter';
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
}));

jest.mock('../../src/services/documentService', () => ({
  extractDocumentContent: jest
    .fn()
    .mockResolvedValue({ text: 'Nội dung tài liệu', truncated: false }),
}));

jest.mock('../../src/utils/guildResolver', () => ({
  resolveGuildId: jest.fn().mockResolvedValue('guild-uuid'),
}));

jest.mock('../../src/workers/aiWorker', () => ({
  aiDocumentQueue: { add: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../../src/utils/interactionReply', () => ({
  sendEphemeralAfterDefer: jest.fn().mockResolvedValue(undefined),
}));

function makeInteraction(): any {
  return {
    token: 'token',
    guildId: 'guild-1',
    user: { id: 'discord-123', username: 'Student' },
    client: { user: { id: 'app-1' } },
    options: {
      getString: jest.fn((name: string) => (name === 'ten_bo_the' ? 'Deck' : 'Nội dung tài liệu')),
      getAttachment: jest.fn().mockReturnValue(null),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
  };
}

const order = (fn: unknown): number => (fn as jest.Mock).mock.invocationCallOrder[0] ?? Infinity;

describe('📑 /tailieu Command — Discord 3s acknowledgement deadline', () => {
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
});
