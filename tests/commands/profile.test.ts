import { execute } from '../../src/commands/profile';
import { prisma } from '../../src/config/prisma';
import { sendEphemeralAfterDefer } from '../../src/utils/interactionReply';

jest.mock('../../src/config/prisma', () => ({
  prisma: {
    user: {
      upsert: jest.fn().mockResolvedValue({ id: 'u1', discordUserId: 'discord-123' }),
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../../src/utils/interactionReply', () => ({
  sendEphemeralAfterDefer: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

function makeUser(): any {
  return {
    id: 'u1',
    discordUserId: 'discord-123',
    username: 'Student',
    streakCount: 3,
    dailyReminderEnabled: false,
    quizSessions: [],
    pomodoroSessions: [],
    flashcardDecks: [],
  };
}

function makeInteraction(reminderValue: string | null): any {
  return {
    id: 'interaction-1',
    token: 'token',
    user: {
      id: 'discord-123',
      username: 'Student',
      displayAvatarURL: jest.fn().mockReturnValue('https://cdn.example/avatar.png'),
    },
    options: {
      getString: jest.fn().mockReturnValue(reminderValue),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    deleteReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
  };
}

const order = (fn: unknown): number => (fn as jest.Mock).mock.invocationCallOrder[0] ?? Infinity;

describe('📊 /profile Command — defer before DB I/O', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(makeUser());
  });

  it('reminder option defers ephemerally before upsert and confirms with editReply', async () => {
    const interaction = makeInteraction('on');

    await execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(prisma.user.upsert).toHaveBeenCalled();
    expect(order(interaction.deferReply)).toBeLessThan(order(prisma.user.upsert));
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Đã **BẬT**') })
    );
  });

  it('profile view defers publicly before findUnique and edits the embed reply', async () => {
    const interaction = makeInteraction(null);

    await execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: false });
    expect(prisma.user.findUnique).toHaveBeenCalled();
    expect(order(interaction.deferReply)).toBeLessThan(order(prisma.user.findUnique));
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array), allowedMentions: { parse: [] } })
    );
  });

  it('missing user is told privately via sendEphemeralAfterDefer', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(null);
    const interaction = makeInteraction(null);

    await execute(interaction);

    expect(sendEphemeralAfterDefer).toHaveBeenCalled();
    expect(sendEphemeralAfterDefer).toHaveBeenCalledWith(
      interaction,
      expect.stringContaining('Bạn chưa có dữ liệu học tập nào')
    );
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('public-mode catch reports the error privately via sendEphemeralAfterDefer', async () => {
    (prisma.user.findUnique as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    const interaction = makeInteraction(null);

    await execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: false });
    expect(sendEphemeralAfterDefer).toHaveBeenCalledWith(
      interaction,
      expect.stringContaining('Có lỗi xảy ra')
    );
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('ephemeral-mode catch reports the error via editReply, never interaction.reply', async () => {
    (prisma.user.upsert as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    const interaction = makeInteraction('off');

    await execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Có lỗi xảy ra') })
    );
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('never calls interaction.reply in the reminder branch', async () => {
    const interaction = makeInteraction('on');

    await execute(interaction);

    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('never calls interaction.reply in the profile view branch', async () => {
    const interaction = makeInteraction(null);

    await execute(interaction);

    expect(interaction.reply).not.toHaveBeenCalled();
  });
});
