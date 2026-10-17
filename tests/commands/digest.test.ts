import { execute } from '../../src/commands/digest';
import { buildWeeklyDigestEmbed } from '../../src/services/weeklyDigestService';

jest.mock('../../src/services/weeklyDigestService', () => ({
  buildWeeklyDigestEmbed: jest.fn(),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

function makeInteraction(): any {
  return {
    user: { id: 'discord-123', username: 'Student' },
    deferReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

const order = (fn: unknown): number => (fn as jest.Mock).mock.invocationCallOrder[0] ?? Infinity;

describe('📊 /digest Command — Discord 3s acknowledgement deadline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (buildWeeklyDigestEmbed as jest.Mock).mockResolvedValue({ title: 'Digest' });
  });

  it('defers ephemerally before building the digest', async () => {
    const interaction = makeInteraction();

    await execute(interaction);

    // Non-vacuous: the service must actually have been called.
    expect(buildWeeklyDigestEmbed).toHaveBeenCalledWith('discord-123');
    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(order(interaction.deferReply)).toBeLessThan(order(buildWeeklyDigestEmbed));
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: [{ title: 'Digest' }] })
    );
  });

  it('reports empty data via editReply', async () => {
    (buildWeeklyDigestEmbed as jest.Mock).mockResolvedValueOnce(null);
    const interaction = makeInteraction();

    await execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Bạn chưa có dữ liệu học tập'),
      })
    );
  });
});
