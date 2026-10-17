import { execute } from '../../src/commands/group';
import { prisma } from '../../src/config/prisma';
import { sendEphemeralAfterDefer } from '../../src/utils/interactionReply';

jest.mock('../../src/utils/interactionReply', () => ({
  sendEphemeralAfterDefer: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/config/prisma', () => ({
  prisma: {
    user: {
      upsert: jest.fn(),
    },
    guild: {
      upsert: jest.fn(),
    },
    studyGroup: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    studyGroupMember: {
      findFirst: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

const order = (fn: unknown): number => (fn as jest.Mock).mock.invocationCallOrder[0] ?? Infinity;

function makeInteraction(subcommand: string, extra: Record<string, unknown> = {}): any {
  return {
    guildId: 'guild-123',
    user: { id: 'discord-u1', username: 'Leader' },
    options: {
      getSubcommand: jest.fn().mockReturnValue(subcommand),
      getString: jest.fn().mockReturnValue('K64_CNTT'),
      getUser: jest.fn().mockReturnValue({ id: 'discord-u2', username: 'Member', bot: false }),
    },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    deleteReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    ...extra,
  };
}

describe('👥 /group Command & Study Groups System', () => {
  const mockUser = { id: 'u1', discordUserId: 'discord-u1', username: 'Leader' };
  const mockGuild = { id: 'g1', discordGuildId: 'guild-123' };

  beforeEach(() => {
    jest.clearAllMocks();
    (mockPrisma.user.upsert as jest.Mock).mockResolvedValue(mockUser);
    (mockPrisma.guild.upsert as jest.Mock).mockResolvedValue(mockGuild);
  });

  it('từ chối khi người dùng gọi lệnh trong tin nhắn riêng (DM)', async () => {
    const mockInteraction: any = {
      guildId: null,
      user: { id: 'discord-u1', username: 'Leader' },
      reply: jest.fn().mockResolvedValue(undefined),
    };

    await execute(mockInteraction);

    expect(mockInteraction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Server Discord'),
      ephemeral: true,
    });
  });

  it('tạo nhóm mới thành công khi chưa ở nhóm nào', async () => {
    (mockPrisma.studyGroupMember.findFirst as jest.Mock).mockResolvedValue(null);
    (mockPrisma.studyGroup.findUnique as jest.Mock).mockResolvedValue(null);

    const mockGroup = {
      id: 'grp-1',
      name: 'K64_CNTT',
      guildId: 'g1',
      ownerId: 'u1',
      maxMembers: 10,
    };

    (mockPrisma.$transaction as jest.Mock).mockImplementationOnce(async (callback) => {
      return callback({
        studyGroup: { create: jest.fn().mockResolvedValue(mockGroup) },
        studyGroupMember: { create: jest.fn().mockResolvedValue({ id: 'mem-1' }) },
      });
    });

    const mockInteraction: any = {
      guildId: 'guild-123',
      user: { id: 'discord-u1', username: 'Leader' },
      options: {
        getSubcommand: jest.fn().mockReturnValue('create'),
        getString: jest.fn().mockReturnValue('K64_CNTT'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    };

    await execute(mockInteraction);

    expect(mockInteraction.reply).not.toHaveBeenCalled();
    expect(mockInteraction.editReply).toHaveBeenCalled();
    const replyPayload = mockInteraction.editReply.mock.calls[0][0];
    expect(replyPayload.embeds[0].data.title).toContain('Khởi Tạo Nhóm Học Tập Thành Công');
  });

  it('chặn tạo nhóm khi tên nhóm đã tồn tại trong Server', async () => {
    (mockPrisma.studyGroupMember.findFirst as jest.Mock).mockResolvedValue(null);
    (mockPrisma.studyGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'existing-grp' });

    const mockInteraction: any = {
      guildId: 'guild-123',
      user: { id: 'discord-u1', username: 'Leader' },
      options: {
        getSubcommand: jest.fn().mockReturnValue('create'),
        getString: jest.fn().mockReturnValue('K64_CNTT'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    };

    await execute(mockInteraction);

    expect(mockInteraction.reply).not.toHaveBeenCalled();
    expect(sendEphemeralAfterDefer).toHaveBeenCalledWith(
      mockInteraction,
      '❌ Nhóm **"K64_CNTT"** đã tồn tại trong server. Vui lòng chọn một tên khác!'
    );
  });

  it('hiển thị thống kê nhóm và vinh danh MVP chính xác (/group stats)', async () => {
    (mockPrisma.studyGroupMember.findFirst as jest.Mock).mockResolvedValue({
      id: 'mem-1',
      group: {
        id: 'grp-1',
        name: 'K64_CNTT',
        maxMembers: 10,
        ownerId: 'u1',
        owner: { username: 'Leader' },
        members: [
          {
            user: {
              id: 'u1',
              username: 'Leader',
              streakCount: 7,
              quizSessions: [{ id: 'q1' }, { id: 'q2' }],
              pomodoroSessions: [{ workMinutes: 50 }],
              flashcardDecks: [{ _count: { cards: 30 } }],
            },
          },
        ],
      },
    });

    const mockInteraction: any = {
      guildId: 'guild-123',
      user: { id: 'discord-u1', username: 'Leader' },
      options: {
        getSubcommand: jest.fn().mockReturnValue('stats'),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    };

    await execute(mockInteraction);

    expect(mockInteraction.deferReply).toHaveBeenCalled();
    expect(mockInteraction.editReply).toHaveBeenCalled();
    const editPayload = mockInteraction.editReply.mock.calls[0][0];
    expect(editPayload.embeds[0].data.title).toContain('Bảng Thống Kê Học Tập');
    expect(editPayload.embeds[0].data.description).toContain('MVP Năng Nổ Tuần Này');
  });

  describe('defer trước mọi I/O (Discord 3s ack deadline)', () => {
    beforeEach(() => {
      // Xóa implementation còn sót từ các test trước để mỗi case độc lập
      (mockPrisma.studyGroup.findFirst as jest.Mock).mockReset();
      (mockPrisma.studyGroup.findMany as jest.Mock).mockReset();
      (mockPrisma.studyGroup.findUnique as jest.Mock).mockReset();
      (mockPrisma.studyGroupMember.findFirst as jest.Mock).mockReset();
    });

    it.each(['create', 'invite', 'kick', 'leave', 'stats', 'list'])(
      '%s defers before user/guild upsert',
      async (subcommand) => {
        const interaction = makeInteraction(subcommand);

        await execute(interaction);

        const deferAt = order(interaction.deferReply);
        expect(deferAt).toBeLessThan(order(mockPrisma.user.upsert));
        expect(deferAt).toBeLessThan(order(mockPrisma.guild.upsert));
        expect(interaction.deferReply).toHaveBeenCalledTimes(1);
        expect(interaction.reply).not.toHaveBeenCalled();
      }
    );

    it('leave defers ephemerally', async () => {
      const interaction = makeInteraction('leave');

      await execute(interaction);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    });

    it.each(['create', 'invite', 'kick', 'stats', 'list'])(
      '%s defers publicly',
      async (subcommand) => {
        const interaction = makeInteraction(subcommand);

        await execute(interaction);

        expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: false });
      }
    );

    it('invite: người không phải Trưởng nhóm nhận thông báo riêng tư, không reply', async () => {
      (mockPrisma.studyGroup.findFirst as jest.Mock).mockResolvedValue(null);
      const interaction = makeInteraction('invite');

      await execute(interaction);

      expect(mockPrisma.studyGroupMember.create).not.toHaveBeenCalled();
      expect(sendEphemeralAfterDefer).toHaveBeenCalledWith(
        interaction,
        '❌ Bạn không phải là Trưởng nhóm của nhóm học tập nào trong Server này.'
      );
      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('kick: người không phải Trưởng nhóm bị chặn, không xóa member', async () => {
      (mockPrisma.studyGroup.findFirst as jest.Mock).mockResolvedValue(null);
      const interaction = makeInteraction('kick');

      await execute(interaction);

      expect(mockPrisma.studyGroupMember.delete).not.toHaveBeenCalled();
      expect(sendEphemeralAfterDefer).toHaveBeenCalledWith(
        interaction,
        '❌ Bạn không có quyền kick vì bạn không phải là Trưởng nhóm.'
      );
    });

    it('kick: thành công gửi qua editReply công khai', async () => {
      (mockPrisma.studyGroup.findFirst as jest.Mock).mockResolvedValue({ id: 'grp-1', name: 'G' });
      (mockPrisma.studyGroupMember.findFirst as jest.Mock).mockResolvedValue({ id: 'mem-2' });
      const interaction = makeInteraction('kick');

      await execute(interaction);

      expect(mockPrisma.studyGroupMember.delete).toHaveBeenCalledWith({ where: { id: 'mem-2' } });
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Đã mời') })
      );
      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('leave: kết quả gửi qua editReply, không kèm key ephemeral', async () => {
      (mockPrisma.studyGroupMember.findFirst as jest.Mock).mockResolvedValue(null);
      const interaction = makeInteraction('leave');

      await execute(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '❌ Bạn hiện không tham gia nhóm học tập nào trong Server này.',
      });
      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('create: lỗi DB báo riêng tư qua sendEphemeralAfterDefer, không reply', async () => {
      (mockPrisma.studyGroupMember.findFirst as jest.Mock).mockRejectedValue(new Error('db down'));
      const interaction = makeInteraction('create');

      await execute(interaction);

      expect(sendEphemeralAfterDefer).toHaveBeenCalledWith(
        interaction,
        '❌ Có lỗi khi tạo nhóm học tập.'
      );
      expect(interaction.reply).not.toHaveBeenCalled();
    });
  });
});
