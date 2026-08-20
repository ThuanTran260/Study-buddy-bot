import { PrismaClient } from '@prisma/client';

describe('Prisma Schema Models', () => {
  it('PrismaClient has all required models and methods', () => {
    const prisma = new PrismaClient();
    expect(typeof prisma.guild.findFirst).toBe('function');
    expect(typeof prisma.user.findFirst).toBe('function');
    expect(typeof prisma.quizSession.findFirst).toBe('function');
    expect(typeof prisma.quizQuestion.findFirst).toBe('function');
    expect(typeof prisma.studyRoom.findFirst).toBe('function');
    expect(typeof prisma.pomodoroSession.findFirst).toBe('function');
    expect(typeof prisma.flashcardDeck.findFirst).toBe('function');
    expect(typeof prisma.flashcard.findFirst).toBe('function');
    expect(typeof prisma.aiUsageLog.findFirst).toBe('function');
    prisma.$disconnect();
  });
});
