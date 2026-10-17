import { execute } from '../../src/events/interactionCreate';
import { sendEphemeralAfterDefer } from '../../src/utils/interactionReply';
import * as hoiCommand from '../../src/commands/hoi';

// Heavy collaborators of interactionCreate are stubbed so the module loads without real I/O.
jest.mock('../../src/config/prisma', () => ({ prisma: { user: { upsert: jest.fn() } } }));
jest.mock('../../src/config/redis', () => ({ redisClient: { set: jest.fn(), del: jest.fn() } }));
jest.mock('../../src/config/env', () => ({ env: { imageGenEnabled: false } }));
jest.mock('../../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../src/services/dbRateLimiter', () => ({ checkDbRateLimit: jest.fn() }));
jest.mock('../../src/services/visualService', () => ({
  extractMermaidCode: jest.fn(),
  renderMermaidToBuffer: jest.fn(),
}));
jest.mock('../../src/workers/imageWorker', () => ({ aiImageQueue: { add: jest.fn() } }));
jest.mock('../../src/utils/interactionReply', () => ({
  sendEphemeralAfterDefer: jest.fn().mockResolvedValue(undefined),
}));

// Every command module is mocked; only /hoi is dispatched and it always rejects.
jest.mock('../../src/commands/hoi', () => ({
  execute: jest.fn().mockRejectedValue(new Error('boom')),
}));
jest.mock('../../src/commands/tomtat', () => ({ execute: jest.fn() }));
jest.mock('../../src/commands/pomodoro', () => ({ execute: jest.fn() }));
jest.mock('../../src/commands/quiz', () => ({ execute: jest.fn() }));
jest.mock('../../src/commands/help', () => ({ execute: jest.fn() }));
jest.mock('../../src/commands/config', () => ({ execute: jest.fn() }));
jest.mock('../../src/commands/profile', () => ({ execute: jest.fn() }));
jest.mock('../../src/commands/digest', () => ({ execute: jest.fn() }));
jest.mock('../../src/commands/flashcard', () => ({ execute: jest.fn() }));
jest.mock('../../src/commands/leaderboard', () => ({ execute: jest.fn() }));
jest.mock('../../src/commands/tailieu', () => ({ execute: jest.fn() }));
jest.mock('../../src/commands/study-plan', () => ({ execute: jest.fn() }));
jest.mock('../../src/commands/group', () => ({ execute: jest.fn() }));

const ERROR_MSG = '❌ Có lỗi khi thực thi lệnh này.';

function makeInteraction(state: { deferred: boolean; replied: boolean }): any {
  return {
    commandName: 'hoi',
    user: { id: 'discord-123' },
    deferred: state.deferred,
    replied: state.replied,
    isButton: () => false,
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    reply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    deleteReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
  };
}

describe('interactionCreate global command error handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (hoiCommand.execute as jest.Mock).mockRejectedValue(new Error('boom'));
    (sendEphemeralAfterDefer as jest.Mock).mockResolvedValue(undefined);
  });

  it('deferred-only: sends the error privately via sendEphemeralAfterDefer', async () => {
    const interaction = makeInteraction({ deferred: true, replied: false });

    await execute(interaction);

    expect(hoiCommand.execute).toHaveBeenCalledWith(interaction);
    expect(sendEphemeralAfterDefer).toHaveBeenCalledTimes(1);
    expect(sendEphemeralAfterDefer).toHaveBeenCalledWith(interaction, ERROR_MSG);
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  it('already replied: follows up privately without overwriting the answer', async () => {
    const interaction = makeInteraction({ deferred: true, replied: true });

    await execute(interaction);

    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: ERROR_MSG, ephemeral: true })
    );
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(sendEphemeralAfterDefer).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('not acknowledged: replies ephemerally', async () => {
    const interaction = makeInteraction({ deferred: false, replied: false });

    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(interaction.reply).toHaveBeenCalledWith({ content: ERROR_MSG, ephemeral: true });
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
    expect(sendEphemeralAfterDefer).not.toHaveBeenCalled();
  });

  it('swallows failures of the error-reporting call in every branch', async () => {
    const deferred = makeInteraction({ deferred: true, replied: false });
    (sendEphemeralAfterDefer as jest.Mock).mockRejectedValueOnce(new Error('gone'));
    await expect(execute(deferred)).resolves.toBeUndefined();

    const replied = makeInteraction({ deferred: true, replied: true });
    replied.followUp.mockRejectedValue(new Error('gone'));
    await expect(execute(replied)).resolves.toBeUndefined();

    const fresh = makeInteraction({ deferred: false, replied: false });
    fresh.reply.mockRejectedValue(new Error('gone'));
    await expect(execute(fresh)).resolves.toBeUndefined();

    expect(sendEphemeralAfterDefer).toHaveBeenCalledTimes(1);
    expect(replied.followUp).toHaveBeenCalledTimes(1);
    expect(fresh.reply).toHaveBeenCalledTimes(1);
  });
});
