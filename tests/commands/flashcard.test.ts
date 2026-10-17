import { execute } from '../../src/commands/flashcard';
import { prisma } from '../../src/config/prisma';
import * as dbRateLimiter from '../../src/services/dbRateLimiter';
import * as aiService from '../../src/services/aiService';
import { sendEphemeralAfterDefer } from '../../src/utils/interactionReply';

jest.mock('../../src/config/prisma', () => ({
  prisma: {
    user: {
      upsert: jest
        .fn()
        .mockResolvedValue({ id: 'u1', discordUserId: 'discord-123', username: 'Student' }),
    },
    flashcardDeck: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'd1', name: 'Deck' }),
    },
    flashcard: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('../../src/services/dbRateLimiter', () => ({
  checkDbRateLimit: jest.fn().mockResolvedValue({ allowed: true, remaining: 5 }),
  recordDbAiUsage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/aiService', () => ({
  generateFlashcardsJson: jest.fn().mockResolvedValue('{}'),
  parseFlashcardAIResponse: jest.fn().mockReturnValue([{ front: 'Q', back: 'A' }]),
}));

jest.mock('../../src/services/streakService', () => ({
  recordUserActivity: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/flashcardManageService', () => ({
  getUserDecks: jest.fn(),
  getDeckWithStats: jest.fn(),
  getDeckCards: jest.fn(),
  renameDeck: jest.fn(),
  resetSm2Progress: jest.fn(),
  deleteDeck: jest.fn(),
  updateCard: jest.fn(),
  deleteCard: jest.fn(),
}));

jest.mock('../../src/utils/guildResolver', () => ({
  resolveGuildId: jest.fn().mockResolvedValue('g1'),
}));

jest.mock('../../src/utils/interactionReply', () => ({
  sendEphemeralAfterDefer: jest.fn().mockResolvedValue(undefined),
}));

const mockPrisma = prisma as unknown as {
  user: { upsert: jest.Mock };
  flashcardDeck: { findUnique: jest.Mock; findMany: jest.Mock; create: jest.Mock };
  flashcard: { findMany: jest.Mock };
};

type Strings = Record<string, string | null>;

const DEFAULT_STRINGS: Strings = {
  ten_bo_the: 'Deck',
  mo_ta: null,
  mat_truoc: 'Front',
  mat_sau: 'Back',
  chu_de: 'Topic',
};

// deferReply sets interaction.deferred = true, like real discord.js
function makeInteraction(subcommand: string, strings: Strings = {}): any {
  const merged = { ...DEFAULT_STRINGS, ...strings };
  const interaction: any = {
    id: 'interaction-1',
    guildId: 'guild-1',
    user: { id: 'discord-123', username: 'Student' },
    deferred: false,
    replied: false,
    options: {
      getSubcommand: jest.fn().mockReturnValue(subcommand),
      getString: jest.fn((name: string) => merged[name] ?? null),
      getInteger: jest.fn().mockReturnValue(null),
      getUser: jest.fn().mockReturnValue({ id: 'discord-999', username: 'Friend', bot: false }),
    },
    deferReply: jest.fn().mockImplementation(async () => {
      interaction.deferred = true;
    }),
    reply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    deleteReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
  };
  return interaction;
}

const order = (fn: unknown): number => (fn as jest.Mock).mock.invocationCallOrder[0] ?? Infinity;

const ALL_SUBCOMMANDS = ['deck-create', 'add', 'review', 'share', 'ai-generate', 'list'];

describe('/flashcard — Discord 3s acknowledgement deadline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.flashcardDeck.findUnique.mockResolvedValue(null);
    mockPrisma.flashcardDeck.findMany.mockResolvedValue([]);
    mockPrisma.flashcard.findMany.mockResolvedValue([]);
  });

  describe('ephemeral subcommands', () => {
    it.each(['deck-create', 'add', 'review', 'share'])(
      '%s defers ephemerally before user upsert',
      async (subcommand) => {
        const interaction = makeInteraction(subcommand);

        await execute(interaction);

        expect(interaction.deferReply).toHaveBeenCalledTimes(1);
        expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
        expect(order(interaction.deferReply)).toBeLessThan(order(mockPrisma.user.upsert));
      }
    );
  });

  describe('public subcommands', () => {
    it.each(['ai-generate', 'list'])(
      '%s defers publicly before user upsert',
      async (subcommand) => {
        const interaction = makeInteraction(subcommand);

        await execute(interaction);

        expect(interaction.deferReply).toHaveBeenCalledTimes(1);
        const args = interaction.deferReply.mock.calls[0];
        expect(args[0]?.ephemeral ?? false).toBe(false);
        expect(order(interaction.deferReply)).toBeLessThan(order(mockPrisma.user.upsert));
      }
    );

    it('ai-generate defers before the rate-limit check', async () => {
      const interaction = makeInteraction('ai-generate');

      await execute(interaction);

      expect(order(interaction.deferReply)).toBeLessThan(order(dbRateLimiter.checkDbRateLimit));
    });
  });

  describe('no interaction.reply after deferring', () => {
    it.each(ALL_SUBCOMMANDS)('%s never calls interaction.reply', async (subcommand) => {
      const interaction = makeInteraction(subcommand);

      await execute(interaction);

      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('review with a deck name never calls interaction.reply', async () => {
      const interaction = makeInteraction('review', { ten_bo_the: 'Security' });

      await execute(interaction);

      expect(interaction.reply).not.toHaveBeenCalled();
      expect(mockPrisma.flashcard.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deck: expect.objectContaining({ userId: 'u1', name: 'Security' }),
          }),
        })
      );
    });

    it('deck-create error path edits the reply instead of replying', async () => {
      mockPrisma.flashcardDeck.findUnique.mockRejectedValueOnce(new Error('db down'));
      const interaction = makeInteraction('deck-create');

      await execute(interaction);

      expect(interaction.reply).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: '❌ Có lỗi khi tạo bộ thẻ.' })
      );
    });
  });

  describe('collectors attach to the message returned by editReply', () => {
    it('review menu attaches its collector to the message returned by editReply', async () => {
      const collector = { on: jest.fn() };
      const message = { createMessageComponentCollector: jest.fn().mockReturnValue(collector) };
      mockPrisma.flashcardDeck.findMany.mockResolvedValue([
        { id: 'd1', name: 'Deck', cards: [{ nextReviewAt: new Date(0) }] },
      ]);
      const interaction = makeInteraction('review', { ten_bo_the: null });
      interaction.editReply.mockResolvedValue(message);

      await execute(interaction);

      expect(interaction.reply).not.toHaveBeenCalled();
      expect(message.createMessageComponentCollector).toHaveBeenCalledTimes(1);
      expect(collector.on).toHaveBeenCalledWith('collect', expect.any(Function));
    });

    it('share confirmation attaches its collector to the message returned by editReply', async () => {
      const collector = { on: jest.fn() };
      const message = { createMessageComponentCollector: jest.fn().mockReturnValue(collector) };
      mockPrisma.flashcardDeck.findUnique.mockResolvedValue({
        id: 'd1',
        name: 'Deck',
        description: null,
        cards: [{ front: 'Q', back: 'A' }],
      });
      (mockPrisma.user.upsert as jest.Mock).mockResolvedValue({
        id: 'u1',
        discordUserId: 'discord-123',
        username: 'Student',
      });
      const interaction = makeInteraction('share');
      interaction.editReply.mockResolvedValue(message);

      await execute(interaction);

      expect(interaction.reply).not.toHaveBeenCalled();
      expect(message.createMessageComponentCollector).toHaveBeenCalledTimes(1);
    });
  });

  describe('private notices after a public defer', () => {
    it('ai-generate rate-limit is sent privately', async () => {
      (dbRateLimiter.checkDbRateLimit as jest.Mock).mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        message: '⏳ Hết hạn mức',
      });
      const interaction = makeInteraction('ai-generate');

      await execute(interaction);

      expect(sendEphemeralAfterDefer).toHaveBeenCalledWith(interaction, '⏳ Hết hạn mức');
      expect(interaction.reply).not.toHaveBeenCalled();
      expect(aiService.generateFlashcardsJson).not.toHaveBeenCalled();
    });

    it('list with no decks is sent privately', async () => {
      const interaction = makeInteraction('list');

      await execute(interaction);

      expect(sendEphemeralAfterDefer).toHaveBeenCalledWith(
        interaction,
        expect.stringContaining('chưa có bộ thẻ nào')
      );
    });

    it('list error is sent privately', async () => {
      mockPrisma.flashcardDeck.findMany.mockRejectedValueOnce(new Error('db down'));
      const interaction = makeInteraction('list');

      await execute(interaction);

      expect(sendEphemeralAfterDefer).toHaveBeenCalledWith(
        interaction,
        '❌ Có lỗi khi tải danh sách bộ thẻ.'
      );
      expect(interaction.reply).not.toHaveBeenCalled();
    });
  });
});
