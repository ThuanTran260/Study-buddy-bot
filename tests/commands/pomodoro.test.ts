import { execute } from '../../src/commands/pomodoro';
import * as pomodoroService from '../../src/services/pomodoroService';
import { sendEphemeralAfterDefer } from '../../src/utils/interactionReply';

jest.mock('../../src/services/pomodoroService', () => {
  class MockStateMachine {
    advancePhase = jest.fn();
  }
  return {
    PomodoroStateMachine: MockStateMachine,
    PomodoroStatus: { WORK: 'WORK', BREAK: 'BREAK' },
    activeTimers: new Map(),
    safeSetVoiceStatus: jest.fn().mockResolvedValue(undefined),
    savePomodoroState: jest.fn().mockResolvedValue(undefined),
    removePomodoroState: jest.fn().mockResolvedValue(undefined),
  };
});

jest.mock('../../src/utils/interactionReply', () => ({
  sendEphemeralAfterDefer: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/streakService', () => ({
  recordUserActivity: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/config/prisma', () => ({
  prisma: {
    user: { upsert: jest.fn().mockResolvedValue({ id: 'u1' }) },
    guild: { upsert: jest.fn().mockResolvedValue({ id: 'g1' }) },
    pomodoroSession: { create: jest.fn().mockResolvedValue({}) },
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

function makeInteraction(subcommand: 'start' | 'stop'): any {
  return {
    id: 'interaction-1',
    token: 'token',
    guildId: 'guild-1',
    channelId: 'text-1',
    channel: undefined,
    user: { id: 'discord-123', username: 'Student' },
    member: { voice: { channel: { id: 'vc1' } } },
    options: {
      getSubcommand: jest.fn().mockReturnValue(subcommand),
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

describe('⏱️ /pomodoro Command — Discord 3s acknowledgement deadline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    pomodoroService.activeTimers.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stop defers publicly before clearing Redis state', async () => {
    const interaction = makeInteraction('stop');

    await execute(interaction);

    // Assert the mocks were actually called so the order check is not vacuous.
    expect(interaction.deferReply).toHaveBeenCalled();
    expect(pomodoroService.removePomodoroState).toHaveBeenCalledWith('vc1');

    // Public defer: called with no args or with { ephemeral: false }.
    const deferArgs = (interaction.deferReply as jest.Mock).mock.calls[0];
    expect(deferArgs[0] === undefined || deferArgs[0]?.ephemeral === false).toBe(true);

    expect(order(interaction.deferReply)).toBeLessThan(order(pomodoroService.removePomodoroState));

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⏹️ Đã dừng phiên Pomodoro và xóa trạng thái kênh.' })
    );
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.not.objectContaining({ ephemeral: expect.anything() })
    );
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('stop failure is reported privately', async () => {
    (pomodoroService.removePomodoroState as jest.Mock).mockRejectedValueOnce(
      new Error('redis down')
    );
    const interaction = makeInteraction('stop');

    await execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalled();
    expect(sendEphemeralAfterDefer).toHaveBeenCalledWith(
      interaction,
      '❌ Có lỗi khi dừng phiên Pomodoro.'
    );
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('start still replies without deferring', async () => {
    const interaction = makeInteraction('start');

    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Bắt đầu Pomodoro') })
    );
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });
});
