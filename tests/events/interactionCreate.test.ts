import { execute } from '../../src/events/interactionCreate';
import { sendEphemeralAfterDefer } from '../../src/utils/interactionReply';
import { prisma } from '../../src/config/prisma';
import * as hoiCommand from '../../src/commands/hoi';
import { logger } from '../../src/utils/logger';

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
    id: 'interaction-123',
    applicationId: 'application-123',
    guildId: 'guild-123',
    createdTimestamp: Date.now(),
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

describe('interactionCreate command diagnostics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('records receipt before waiting on a command and excludes token and input content', async () => {
    let finish!: () => void;
    (hoiCommand.execute as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const interaction = makeInteraction({ deferred: false, replied: false });
    interaction.token = 'private-interaction-token';
    interaction.options = { privateQuestion: 'private-question-content' };

    const pending = execute(interaction);
    const receipt = (logger.info as jest.Mock).mock.calls.find(
      ([message]) => message === '[Discord] Slash command received'
    );
    // Always release the handler, including when the receipt assertion fails.
    finish();
    await pending;

    expect(receipt?.[1]).toEqual(
      expect.objectContaining({
        interactionId: 'interaction-123',
        applicationId: 'application-123',
        command: 'hoi',
        guildId: 'guild-123',
      })
    );
    const output = JSON.stringify((logger.info as jest.Mock).mock.calls);
    expect(output).not.toContain('private-interaction-token');
    expect(output).not.toContain('private-question-content');
  });

  it('records successful acknowledgement after the command finishes', async () => {
    const interaction = makeInteraction({ deferred: false, replied: false });
    (hoiCommand.execute as jest.Mock).mockImplementationOnce(async () => {
      interaction.replied = true;
    });

    await execute(interaction);

    expect(logger.info).toHaveBeenCalledWith(
      '[Discord] Slash command completed',
      expect.objectContaining({
        interactionId: 'interaction-123',
        replied: true,
        deferred: false,
        durationMs: expect.any(Number),
      })
    );
  });

  it('correlates callback errors with the interaction and acknowledgement state', async () => {
    (hoiCommand.execute as jest.Mock).mockRejectedValueOnce(new Error('Unknown interaction'));
    const interaction = makeInteraction({ deferred: false, replied: false });

    await execute(interaction);

    expect(logger.error).toHaveBeenCalledWith(
      'Error executing command',
      expect.objectContaining({
        interactionId: 'interaction-123',
        applicationId: 'application-123',
        replied: false,
        deferred: false,
        durationMs: expect.any(Number),
      })
    );
  });

  it('warns once if the actual command is still waiting for acknowledgement after two seconds', async () => {
    jest.useFakeTimers();
    let finish!: () => void;
    (hoiCommand.execute as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const interaction = makeInteraction({ deferred: false, replied: false });
    const pending = execute(interaction);
    try {
      jest.advanceTimersByTime(1999);
      expect(logger.warn).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(logger.warn).toHaveBeenCalledWith(
        '[Discord] Command acknowledgement still pending',
        expect.objectContaining({
          interactionId: interaction.id,
          command: 'hoi',
          durationMs: 2000,
          ageMs: 2000,
        })
      );
      jest.advanceTimersByTime(30_000);
      expect(logger.warn).toHaveBeenCalledTimes(1);
    } finally {
      finish();
      await pending;
      jest.useRealTimers();
    }
  });

  it('clears the acknowledgement warning after a command finishes', async () => {
    jest.useFakeTimers();
    try {
      (hoiCommand.execute as jest.Mock).mockResolvedValueOnce(undefined);
      await execute(makeInteraction({ deferred: false, replied: false }));
      jest.advanceTimersByTime(30_000);
      expect(logger.warn).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not warn when a long-running command has already deferred its reply', async () => {
    jest.useFakeTimers();
    let finish!: () => void;
    (hoiCommand.execute as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const pending = execute(makeInteraction({ deferred: true, replied: false }));
    try {
      jest.advanceTimersByTime(30_000);
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      finish();
      await pending;
      jest.useRealTimers();
    }
  });
});

// Invocation order of a jest mock; lower number means called earlier.
// A never-called mock yields Infinity so an order check against it cannot pass vacuously.
function order(mock: jest.Mock): number {
  return mock.mock.invocationCallOrder[0] ?? Infinity;
}

function makeButtonInteraction(): any {
  return {
    customId: 'disable_daily_reminder',
    user: { id: 'discord-123', username: 'tester' },
    isButton: () => true,
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
  };
}

describe('interactionCreate disable_daily_reminder button', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reminder button defers ephemerally before the upsert', async () => {
    const interaction = makeButtonInteraction();

    await execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(prisma.user.upsert).toHaveBeenCalledTimes(1);
    expect(order(interaction.deferReply)).toBeLessThan(order(prisma.user.upsert as jest.Mock));
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Đã tắt tính năng nhắc nhở') })
    );
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('reminder button failure is reported via editReply', async () => {
    (prisma.user.upsert as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    const interaction = makeButtonInteraction();

    await execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(prisma.user.upsert).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '❌ Có lỗi khi cập nhật cài đặt nhắc nhở.',
    });
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});
