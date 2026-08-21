import { execute } from '../../src/commands/group';
import { prisma } from '../../src/config/prisma';

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
    };

    await execute(mockInteraction);

    expect(mockInteraction.reply).toHaveBeenCalled();
    const replyPayload = mockInteraction.reply.mock.calls[0][0];
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
    };

    await execute(mockInteraction);

    expect(mockInteraction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('đã tồn tại'),
      ephemeral: true,
    });
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
});
