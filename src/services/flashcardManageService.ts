import { Prisma, type Flashcard, type FlashcardDeck } from '@prisma/client';
import { prisma } from '../config/prisma';

export async function getUserDecks(userId: string): Promise<Array<{ id: string; name: string }>> {
  return prisma.flashcardDeck.findMany({
    where: { userId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
    take: 25,
  });
}

export interface DeckWithStats {
  deck: FlashcardDeck & { _count: { cards: number } };
  total: number;
  due: number;
}

export async function getDeckWithStats(
  deckId: string,
  userId: string
): Promise<DeckWithStats | null> {
  const deck = await prisma.flashcardDeck.findFirst({
    where: { id: deckId, userId },
    include: { _count: { select: { cards: true } } },
  });
  if (!deck) {
    return null;
  }
  const due = await prisma.flashcard.count({
    where: { deckId: deck.id, nextReviewAt: { lte: new Date() } },
  });
  return { deck, total: deck._count.cards, due };
}

export async function getDeckCards(deckId: string, userId: string): Promise<Flashcard[]> {
  return prisma.flashcard.findMany({
    where: { deckId, deck: { userId } },
    orderBy: { createdAt: 'asc' },
  });
}

export type RenameDeckResult =
  | { success: true; deck: FlashcardDeck }
  | { success: false; reason: 'NOT_FOUND' | 'EMPTY_NAME' | 'NAME_EXISTS' };

export async function renameDeck(
  deckId: string,
  userId: string,
  newName: string,
  newDescription?: string
): Promise<RenameDeckResult> {
  const owned = await prisma.flashcardDeck.findFirst({
    where: { id: deckId, userId },
    select: { id: true, name: true },
  });
  if (!owned) {
    return { success: false as const, reason: 'NOT_FOUND' as const };
  }
  const name = newName.trim();
  if (!name) {
    return { success: false as const, reason: 'EMPTY_NAME' as const };
  }
  if (name !== owned.name) {
    const conflict = await prisma.flashcardDeck.findUnique({
      where: { userId_name: { userId, name } },
      select: { id: true },
    });
    if (conflict) {
      return { success: false as const, reason: 'NAME_EXISTS' as const };
    }
  }
  try {
    const deck = await prisma.flashcardDeck.update({
      where: { id: deckId },
      data: {
        name,
        ...(newDescription !== undefined ? { description: newDescription.slice(0, 200) } : {}),
      },
    });
    return { success: true as const, deck };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { success: false as const, reason: 'NAME_EXISTS' as const };
    }
    throw e;
  }
}

export async function resetSm2Progress(
  deckId: string,
  userId: string
): Promise<{ success: boolean; count: number }> {
  const { count } = await prisma.flashcard.updateMany({
    where: { deckId, deck: { userId } },
    data: { repetition: 0, interval: 1, easeFactor: 2.5, nextReviewAt: new Date() },
  });
  return { success: true, count };
}

export async function deleteDeck(deckId: string, userId: string): Promise<{ success: boolean }> {
  const { count } = await prisma.flashcardDeck.deleteMany({ where: { id: deckId, userId } });
  return { success: count === 1 };
}

export async function updateCard(
  cardId: string,
  deckId: string,
  userId: string,
  front: string,
  back: string
): Promise<{ success: boolean }> {
  const { count } = await prisma.flashcard.updateMany({
    where: { id: cardId, deckId, deck: { userId } },
    data: { front: front.trim().slice(0, 1000), back: back.trim().slice(0, 1000) },
  });
  return { success: count === 1 };
}

export async function deleteCard(
  cardId: string,
  deckId: string,
  userId: string
): Promise<{ success: boolean }> {
  const { count } = await prisma.flashcard.deleteMany({
    where: { id: cardId, deckId, deck: { userId } },
  });
  return { success: count === 1 };
}
