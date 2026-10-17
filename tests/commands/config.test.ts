import { execute } from '../../src/commands/config';
import { prisma } from '../../src/config/prisma';

jest.mock('../../src/config/prisma', () => ({
  prisma: {
    guild: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

function makeInteraction(subcommand: string, guildId: string | null = 'guild-1'): any {
  return {
    guildId,
    guild: { name: 'Test Server' },
    options: {
      getSubcommand: jest.fn().mockReturnValue(subcommand),
      getChannel: jest.fn().mockReturnValue({ id: 'chan-1', name: 'general' }),
      getInteger: jest.fn().mockReturnValue(5),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

const order = (fn: unknown): number => (fn as jest.Mock).mock.invocationCallOrder[0] ?? Infinity;

describe('⚙️ /config Command — Discord 3s acknowledgement deadline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Each subcommand hits a different Prisma call; pick the one that must come after defer.
  it.each([
    ['set-study-room', 'upsert'],
    ['set-log-channel', 'upsert'],
    ['set-max-rooms', 'upsert'],
    ['view', 'findUnique'],
  ] as const)('%s defers ephemerally before DB I/O', async (subcommand, dbMethod) => {
    const interaction = makeInteraction(subcommand);
    const dbFn = prisma.guild[dbMethod] as unknown as jest.Mock;

    await execute(interaction);

    // Non-vacuous: the DB mock must actually have been called, otherwise order() is Infinity.
    expect(dbFn).toHaveBeenCalled();
    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(order(interaction.deferReply)).toBeLessThan(order(dbFn));
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('rejects outside a guild without deferring', async () => {
    const interaction = makeInteraction('view', null);

    await execute(interaction);

    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    expect(prisma.guild.findUnique).not.toHaveBeenCalled();
  });
});
