import {
  getUserDecks,
  getDeckWithStats,
  getDeckCards,
  renameDeck,
  resetSm2Progress,
  deleteDeck,
  updateCard,
  deleteCard,
} from '../../src/services/flashcardManageService';
import { prisma } from '../../src/config/prisma';
import { Prisma } from '@prisma/client';

jest.mock('../../src/config/prisma', () => ({
  prisma: {
    flashcardDeck: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    flashcard: {
      count: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('flashcardManageService', () => {
  const userId = 'user-1';
  const deckId = 'deck-1';
  const cardId = 'card-1';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getUserDecks scopes by userId with take 25 ordered by name asc', async () => {
    const decks = [{ id: 'd1', name: 'Alpha' }];
    (mockPrisma.flashcardDeck.findMany as jest.Mock).mockResolvedValue(decks);

    const result = await getUserDecks(userId);

    expect(result).toEqual(decks);
    expect(mockPrisma.flashcardDeck.findMany).toHaveBeenCalledWith({
      where: { userId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 25,
    });
  });

  it('getDeckWithStats returns deck with total and due counts when found', async () => {
    const deck = { id: deckId, name: 'Deck', _count: { cards: 5 } };
    (mockPrisma.flashcardDeck.findFirst as jest.Mock).mockResolvedValue(deck);
    (mockPrisma.flashcard.count as jest.Mock).mockResolvedValue(2);

    const result = await getDeckWithStats(deckId, userId);

    expect(mockPrisma.flashcardDeck.findFirst).toHaveBeenCalledWith({
      where: { id: deckId, userId },
      include: { _count: { select: { cards: true } } },
    });
    expect(mockPrisma.flashcard.count).toHaveBeenCalledWith({
      where: { deckId: deck.id, nextReviewAt: { lte: expect.any(Date) } },
    });
    expect(result).toEqual({ deck, total: 5, due: 2 });
  });

  it('getDeckWithStats returns null when deck is not found', async () => {
    (mockPrisma.flashcardDeck.findFirst as jest.Mock).mockResolvedValue(null);

    const result = await getDeckWithStats(deckId, userId);

    expect(result).toBeNull();
    expect(mockPrisma.flashcard.count).not.toHaveBeenCalled();
  });

  it('getDeckCards scopes by deckId and owner ordered by createdAt asc', async () => {
    const cards = [{ id: 'c1' }];
    (mockPrisma.flashcard.findMany as jest.Mock).mockResolvedValue(cards);

    const result = await getDeckCards(deckId, userId);

    expect(result).toEqual(cards);
    expect(mockPrisma.flashcard.findMany).toHaveBeenCalledWith({
      where: { deckId, deck: { userId } },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('renameDeck renames successfully when name is free', async () => {
    (mockPrisma.flashcardDeck.findFirst as jest.Mock).mockResolvedValue({
      id: deckId,
      name: 'Old',
    });
    (mockPrisma.flashcardDeck.findUnique as jest.Mock).mockResolvedValue(null);
    const updated = { id: deckId, name: 'New' };
    (mockPrisma.flashcardDeck.update as jest.Mock).mockResolvedValue(updated);

    const result = await renameDeck(deckId, userId, '  New  ', 'desc');

    expect(mockPrisma.flashcardDeck.findFirst).toHaveBeenCalledWith({
      where: { id: deckId, userId },
      select: { id: true, name: true },
    });
    expect(mockPrisma.flashcardDeck.findUnique).toHaveBeenCalledWith({
      where: { userId_name: { userId, name: 'New' } },
      select: { id: true },
    });
    expect(mockPrisma.flashcardDeck.update).toHaveBeenCalledWith({
      where: { id: deckId },
      data: { name: 'New', description: 'desc' },
    });
    expect(result).toEqual({ success: true, deck: updated });
  });

  it('renameDeck returns NAME_EXISTS on pre-check conflict', async () => {
    (mockPrisma.flashcardDeck.findFirst as jest.Mock).mockResolvedValue({
      id: deckId,
      name: 'Old',
    });
    (mockPrisma.flashcardDeck.findUnique as jest.Mock).mockResolvedValue({ id: 'other' });

    const result = await renameDeck(deckId, userId, 'Taken');

    expect(result).toEqual({ success: false, reason: 'NAME_EXISTS' });
    expect(mockPrisma.flashcardDeck.update).not.toHaveBeenCalled();
  });

  it('renameDeck maps P2002 race to NAME_EXISTS', async () => {
    (mockPrisma.flashcardDeck.findFirst as jest.Mock).mockResolvedValue({
      id: deckId,
      name: 'Old',
    });
    (mockPrisma.flashcardDeck.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.flashcardDeck.update as jest.Mock).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('x', { code: 'P2002', clientVersion: 'test' })
    );

    const result = await renameDeck(deckId, userId, 'Raced');

    expect(result).toEqual({ success: false, reason: 'NAME_EXISTS' });
  });

  it('renameDeck returns NOT_FOUND when deck is not owned', async () => {
    (mockPrisma.flashcardDeck.findFirst as jest.Mock).mockResolvedValue(null);

    const result = await renameDeck(deckId, userId, 'New');

    expect(result).toEqual({ success: false, reason: 'NOT_FOUND' });
    expect(mockPrisma.flashcardDeck.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.flashcardDeck.update).not.toHaveBeenCalled();
  });

  it('renameDeck returns EMPTY_NAME when trimmed name is empty', async () => {
    (mockPrisma.flashcardDeck.findFirst as jest.Mock).mockResolvedValue({
      id: deckId,
      name: 'Old',
    });

    const result = await renameDeck(deckId, userId, '   ');

    expect(result).toEqual({ success: false, reason: 'EMPTY_NAME' });
    expect(mockPrisma.flashcardDeck.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.flashcardDeck.update).not.toHaveBeenCalled();
  });

  it('resetSm2Progress resets to defaults and returns count', async () => {
    (mockPrisma.flashcard.updateMany as jest.Mock).mockResolvedValue({ count: 3 });

    const result = await resetSm2Progress(deckId, userId);

    expect(mockPrisma.flashcard.updateMany).toHaveBeenCalledWith({
      where: { deckId, deck: { userId } },
      data: { repetition: 0, interval: 1, easeFactor: 2.5, nextReviewAt: expect.any(Date) },
    });
    expect(result).toEqual({ success: true, count: 3 });
  });

  it('deleteDeck returns true on success and false when not owner', async () => {
    (mockPrisma.flashcardDeck.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
    await expect(deleteDeck(deckId, userId)).resolves.toEqual({ success: true });
    expect(mockPrisma.flashcardDeck.deleteMany).toHaveBeenCalledWith({
      where: { id: deckId, userId },
    });

    (mockPrisma.flashcardDeck.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
    await expect(deleteDeck(deckId, 'other-user')).resolves.toEqual({ success: false });
  });

  it('updateCard trims and slices 1500-char input to 1000 on success', async () => {
    (mockPrisma.flashcard.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    const front = `  ${'f'.repeat(1500)}  `;
    const back = `  ${'b'.repeat(1500)}  `;

    const result = await updateCard(cardId, deckId, userId, front, back);

    expect(result).toEqual({ success: true });
    const call = (mockPrisma.flashcard.updateMany as jest.Mock).mock.calls[0]?.[0] as {
      where: unknown;
      data: { front: string; back: string };
    };
    expect(call.data.front).toHaveLength(1000);
    expect(call.data.back).toHaveLength(1000);
    expect(mockPrisma.flashcard.updateMany).toHaveBeenCalledWith({
      where: { id: cardId, deckId, deck: { userId } },
      data: { front: 'f'.repeat(1000), back: 'b'.repeat(1000) },
    });
  });

  it('updateCard and deleteCard return false when count is 0', async () => {
    (mockPrisma.flashcard.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    await expect(updateCard(cardId, deckId, userId, 'front', 'back')).resolves.toEqual({
      success: false,
    });

    (mockPrisma.flashcard.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
    await expect(deleteCard(cardId, deckId, userId)).resolves.toEqual({ success: true });
    expect(mockPrisma.flashcard.deleteMany).toHaveBeenCalledWith({
      where: { id: cardId, deckId, deck: { userId } },
    });

    (mockPrisma.flashcard.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
    await expect(deleteCard(cardId, deckId, userId)).resolves.toEqual({ success: false });
  });
});
